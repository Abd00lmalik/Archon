import { expect } from "chai";
import { acceptAndPromote } from "./helpers/reviewFlow";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const FIVE_DAYS = 5 * 24 * 60 * 60;

describe("Archon Hook + ERC8183Job", function () {
  async function deployFixture() {
    const [owner, client, agentA, agentB, treasury, other] = await ethers.getSigners();

    const sourceRegistry = await (await ethers.getContractFactory("SourceRegistry")).connect(owner).deploy();
    await sourceRegistry.waitForDeployment();

    const registry = await (await ethers.getContractFactory("ERC8004ValidationRegistry")).connect(owner).deploy();
    await registry.waitForDeployment();

    const hook = await (await ethers.getContractFactory("CredentialHook")).connect(owner).deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const usdc = await (await ethers.getContractFactory("MockUSDC")).connect(owner).deploy();
    await usdc.waitForDeployment();

    const oneMillion = ethers.parseUnits("1000000", 6);
    await usdc.connect(owner).mint(client.address, oneMillion);
    await usdc.connect(owner).mint(agentA.address, oneMillion);
    await usdc.connect(owner).mint(agentB.address, oneMillion);

    const job = await (await ethers.getContractFactory("ERC8183Job"))
      .connect(owner)
      .deploy(await hook.getAddress(), await usdc.getAddress(), await sourceRegistry.getAddress(), treasury.address, 1000);
    await job.waitForDeployment();
    await hook.connect(owner).registerSourceContract(await job.getAddress(), true);

    await usdc.connect(client).approve(await job.getAddress(), oneMillion);

    return { owner, client, agentA, agentB, treasury, other, registry, hook, usdc, job };
  }

  async function createJob(
    job: any,
    client: any,
    reward = ethers.parseUnits("300", 6),
    maxApprovals = 3
  ) {
    const deadline = (await time.latest()) + 2 * 60 * 60;
    await job
      .connect(client)
      .createJob("Build Landing", "Ship responsive page", deadline, reward, maxApprovals);
    return { deadline, reward, maxApprovals };
  }

  it("deploys and wires source registry, hook authorization, and job registration", async function () {
    const { owner, registry, hook, job } = await deployFixture();
    expect(await registry.authorizedIssuers(await hook.getAddress())).to.equal(true);
    expect(await hook.registeredSourceContracts(await job.getAddress())).to.equal(true);
    expect(await hook.owner()).to.equal(owner.address);
  });

  it("enforces finalist and winner approval cap", async function () {
    const { job, client, agentA, agentB, other } = await deployFixture();
    await createJob(job, client);

    const fourth = (await ethers.getSigners())[6];
    await job.connect(agentA).submitDirect(0, "https://github.com/a");
    await job.connect(agentB).submitDirect(0, "https://github.com/b");
    await job.connect(other).submitDirect(0, "https://github.com/c");
    await job.connect(fourth).submitDirect(0, "https://github.com/d");
    await acceptAndPromote(job, client, 0, [
      agentA.address,
      agentB.address,
      other.address,
      fourth.address
    ]);
    await job.connect(client).selectFinalists(0, [agentA.address, agentB.address, other.address, fourth.address], FIVE_DAYS);
    await time.increase(5 * 24 * 60 * 60 + 1);

    await expect(
      job
        .connect(client)
        .finalizeWinners(
          0,
          [agentA.address, agentB.address, other.address, fourth.address],
          [
            ethers.parseUnits("75", 6),
            ethers.parseUnits("75", 6),
            ethers.parseUnits("75", 6),
            ethers.parseUnits("75", 6)
          ]
        )
    ).to.be.reverted;
  });

  it("pays reward + mints weighted credential when approved submitter claims", async function () {
    const { registry, usdc, job, client, agentA, treasury } = await deployFixture();
    await createJob(job, client);

    await job.connect(agentA).submitDirect(0, "https://github.com/work");
    await acceptAndPromote(job, client, 0, [agentA.address]);
    await job.connect(client).selectFinalists(0, [agentA.address], FIVE_DAYS);
    await time.increase(5 * 24 * 60 * 60 + 1);
    await job.connect(client).finalizeWinners(0, [agentA.address], [ethers.parseUnits("100", 6)]);

    const treasuryBefore = await usdc.balanceOf(treasury.address);
    const agentBefore = await usdc.balanceOf(agentA.address);

    await expect(job.connect(agentA).claimCredential(0))
      .to.emit(registry, "CredentialIssued")
      .withArgs(agentA.address, 0, 1, anyValue, "job", 100, await hookIssuer(job))
      .and.to.emit(job, "RewardPaid");

    const credential = await registry.getCredential(1);
    expect(credential.sourceType).to.equal("job");
    expect(credential.weight).to.equal(100);
    expect(credential.agent).to.equal(agentA.address);

    const grossReward = ethers.parseUnits("100", 6);
    const expectedFee = (grossReward * 1000n) / 10000n;
    const expectedAgent = grossReward - expectedFee;

    expect(await usdc.balanceOf(treasury.address)).to.equal(treasuryBefore + expectedFee);
    expect(await usdc.balanceOf(agentA.address)).to.equal(agentBefore + expectedAgent);
  });

  it("rejects unregistered source contracts at hook boundary", async function () {
    const { hook, other } = await deployFixture();
    await expect(
      hook.connect(other).onActivityComplete(other.address, 1, "job", 100)
    ).to.be.reverted;
  });

  async function hookIssuer(job: any) {
    return await job.hook();
  }
});
