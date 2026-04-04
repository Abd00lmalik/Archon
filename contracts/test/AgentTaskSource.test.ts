import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("AgentTaskSource", function () {
  async function deployFixture() {
    const [owner, poster, agent, verifier, treasury, other] = await ethers.getSigners();

    const sourceRegistry = await (await ethers.getContractFactory("SourceRegistry")).connect(owner).deploy();
    await sourceRegistry.waitForDeployment();
    await sourceRegistry.connect(owner).approveOperator("agent_task", poster.address);
    await sourceRegistry.connect(owner).approveOperator("agent_task", verifier.address);

    const registry = await (await ethers.getContractFactory("ERC8004ValidationRegistry")).connect(owner).deploy();
    await registry.waitForDeployment();

    const hook = await (await ethers.getContractFactory("CredentialHook")).connect(owner).deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const usdc = await (await ethers.getContractFactory("MockUSDC")).connect(owner).deploy();
    await usdc.waitForDeployment();

    const seed = ethers.parseUnits("1000000", 6);
    await usdc.connect(owner).mint(poster.address, seed);
    await usdc.connect(owner).mint(agent.address, seed);
    await usdc.connect(poster).approve(await hook.getAddress(), seed);

    const tasks = await (await ethers.getContractFactory("AgentTaskSource"))
      .connect(owner)
      .deploy(
        await hook.getAddress(),
        await usdc.getAddress(),
        await sourceRegistry.getAddress(),
        treasury.address,
        1000
      );
    await tasks.waitForDeployment();
    await hook.connect(owner).registerSourceContract(await tasks.getAddress(), true);

    await usdc.connect(poster).approve(await tasks.getAddress(), seed);

    return { owner, poster, agent, verifier, treasury, other, sourceRegistry, registry, hook, usdc, tasks };
  }

  async function postTask(tasks: any, poster: any, reward = ethers.parseUnits("90", 6)) {
    const deadline = (await time.latest()) + 2 * 60 * 60;
    await tasks.connect(poster).postTask("Evaluate model outputs", "ipfs://input-cid", deadline, reward);
    return { deadline, reward };
  }

  it("completes full paid task flow and mints credential", async function () {
    const { poster, agent, verifier, treasury, usdc, registry, tasks } = await deployFixture();
    const { reward } = await postTask(tasks, poster);

    await tasks.connect(agent).claimTask(0);
    await tasks.connect(agent).submitOutput(0, "ipfs://output-cid");
    await time.increase(16 * 60);
    await tasks.connect(verifier).validateOutput(0, true, "Looks good");

    const treasuryBefore = await usdc.balanceOf(treasury.address);
    const agentBefore = await usdc.balanceOf(agent.address);

    await expect(tasks.connect(agent).claimRewardAndCredential(0))
      .to.emit(tasks, "AgentTaskCompleted")
      .withArgs(0, agent.address, 1, 130);

    const fee = (reward * 1000n) / 10000n;
    const net = reward - fee;
    expect(await usdc.balanceOf(treasury.address)).to.equal(treasuryBefore + fee);
    expect(await usdc.balanceOf(agent.address)).to.equal(agentBefore + net);

    const credential = await registry.getCredential(1);
    expect(credential.sourceType).to.equal("agent_task");
    expect(credential.weight).to.equal(130);
  });

  it("blocks unauthorized validators and invalid claims", async function () {
    const { poster, agent, other, tasks } = await deployFixture();
    await postTask(tasks, poster);
    await tasks.connect(agent).claimTask(0);
    await tasks.connect(agent).submitOutput(0, "ipfs://output-cid");
    await time.increase(16 * 60);

    await expect(tasks.connect(other).validateOutput(0, true, "ok")).to.be.revertedWith("not authorized validator");
    await expect(tasks.connect(agent).claimRewardAndCredential(0)).to.be.revertedWith("task not validated");
  });

  it("enforces deadline and supports poster refunds", async function () {
    const { poster, agent, tasks, usdc } = await deployFixture();
    const { deadline, reward } = await postTask(tasks, poster);
    await tasks.connect(agent).claimTask(0);

    await time.increaseTo(deadline + 1);
    await expect(tasks.connect(agent).submitOutput(0, "ipfs://late")).to.be.revertedWith("task deadline passed");

    const before = await usdc.balanceOf(poster.address);
    await expect(tasks.connect(poster).refundExpiredTask(0))
      .to.emit(tasks, "TaskRefunded")
      .withArgs(0, poster.address, reward);
    expect(await usdc.balanceOf(poster.address)).to.equal(before + reward);
  });

  it("prevents double-claim and enforces credential cooldown", async function () {
    const { poster, agent, verifier, tasks } = await deployFixture();
    await postTask(tasks, poster);
    await postTask(tasks, poster);

    await tasks.connect(agent).claimTask(0);
    await tasks.connect(agent).submitOutput(0, "ipfs://output-0");
    await time.increase(16 * 60);
    await tasks.connect(verifier).validateOutput(0, true, "ok");
    await tasks.connect(agent).claimRewardAndCredential(0);
    await expect(tasks.connect(agent).claimRewardAndCredential(0)).to.be.revertedWith("already claimed");

    await tasks.connect(agent).claimTask(1);
    await tasks.connect(agent).submitOutput(1, "ipfs://output-1");
    await time.increase(16 * 60);
    await tasks.connect(verifier).validateOutput(1, true, "ok");
    await expect(tasks.connect(agent).claimRewardAndCredential(1)).to.be.revertedWith("credential cooldown active");
  });
});
