import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("CredentialHook + ERC8183Job", function () {
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

    await sourceRegistry.connect(owner).approveOperator("job", client.address);

    const job = await (await ethers.getContractFactory("ERC8183Job"))
      .connect(owner)
      .deploy(await hook.getAddress(), await usdc.getAddress(), await sourceRegistry.getAddress(), treasury.address, 1000);
    await job.waitForDeployment();
    await hook.connect(owner).registerSourceContract(await job.getAddress(), true);

    await usdc.connect(client).approve(await job.getAddress(), oneMillion);

    return { owner, client, agentA, agentB, treasury, other, sourceRegistry, registry, hook, usdc, job };
  }

  async function createJob(job: any, client: any, reward = ethers.parseUnits("300", 6)) {
    const deadline = (await time.latest()) + 2 * 60 * 60;
    await job.connect(client).createJob("Build Landing", "Ship responsive page", deadline, reward);
    return { deadline, reward };
  }

  it("deploys and wires source registry, hook authorization, and job registration", async function () {
    const { owner, registry, hook, job } = await deployFixture();
    expect(await registry.authorizedIssuers(await hook.getAddress())).to.equal(true);
    expect(await hook.registeredSourceContracts(await job.getAddress())).to.equal(true);
    expect(await hook.owner()).to.equal(owner.address);
  });

  it("creates escrowed jobs only for approved source operators", async function () {
    const { job, sourceRegistry, client, other } = await deployFixture();
    const deadline = (await time.latest()) + 7200;
    const reward = ethers.parseUnits("300", 6);

    await expect(job.connect(other).createJob("Title", "Desc", deadline, reward)).to.be.revertedWith(
      "source operator not approved"
    );

    await sourceRegistry.approveOperator("job", other.address);
    await expect(job.connect(other).createJob("Title", "Desc", deadline, reward)).to.be.revertedWith(
      "insufficient allowance"
    );

    await expect(job.connect(client).createJob("Title", "Desc", deadline, reward))
      .to.emit(job, "JobCreated")
      .withArgs(0, client.address, "Title", "Desc", deadline, reward);
  });

  it("enforces review delay and approval cap", async function () {
    const { owner, job, client, agentA, agentB, other } = await deployFixture();
    await createJob(job, client);
    await sourceRegistryApprove(job, owner, other);

    await job.connect(agentA).acceptJob(0);
    await job.connect(agentA).submitDeliverable(0, "https://github.com/a");

    await expect(job.connect(client).approveSubmission(0, agentA.address)).to.be.revertedWith(
      "review delay not elapsed"
    );
    await time.increase(16 * 60);
    await job.connect(client).approveSubmission(0, agentA.address);

    await job.connect(agentB).acceptJob(0);
    await job.connect(agentB).submitDeliverable(0, "https://github.com/b");
    await time.increase(16 * 60);
    await job.connect(client).approveSubmission(0, agentB.address);

    await job.connect(other).acceptJob(0);
    await job.connect(other).submitDeliverable(0, "https://github.com/c");
    await time.increase(16 * 60);
    await job.connect(client).approveSubmission(0, other.address);

    const fourth = (await ethers.getSigners())[6];
    await job.connect(fourth).acceptJob(0);
    await job.connect(fourth).submitDeliverable(0, "https://github.com/d");
    await time.increase(16 * 60);
    await expect(job.connect(client).approveSubmission(0, fourth.address)).to.be.revertedWith("max approvals reached");
  });

  it("pays reward + mints weighted credential when approved submitter claims", async function () {
    const { registry, usdc, job, client, agentA, treasury } = await deployFixture();
    await createJob(job, client);

    await job.connect(agentA).acceptJob(0);
    await job.connect(agentA).submitDeliverable(0, "https://github.com/work");
    await time.increase(16 * 60);
    await job.connect(client).approveSubmission(0, agentA.address);

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
    ).to.be.revertedWith("source contract not registered");
  });

  async function sourceRegistryApprove(job: any, owner: any, wallet: any) {
    const sourceRegistryAddress = await job.sourceRegistry();
    const sourceRegistry = await ethers.getContractAt("SourceRegistry", sourceRegistryAddress, owner);
    await sourceRegistry.approveOperator("job", wallet.address);

    const oneMillion = ethers.parseUnits("1000000", 6);
    const usdcAddress = await job.usdc();
    const usdc = await ethers.getContractAt("MockUSDC", usdcAddress, owner);
    await usdc.mint(wallet.address, oneMillion);
    await usdc.connect(wallet).approve(await job.getAddress(), oneMillion);
  }

  async function hookIssuer(job: any) {
    return await job.hook();
  }
});
