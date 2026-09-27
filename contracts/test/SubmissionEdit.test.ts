import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Submission edit + judge participation", function () {
  async function deployFixture() {
    const [owner, client, judgeA, agentA, agentB, stranger, treasury] =
      await ethers.getSigners();

    const sourceRegistry = await (await ethers.getContractFactory("SourceRegistry"))
      .connect(owner)
      .deploy();
    await sourceRegistry.waitForDeployment();

    const registry = await (await ethers.getContractFactory("ERC8004ValidationRegistry"))
      .connect(owner)
      .deploy();
    await registry.waitForDeployment();

    const hook = await (await ethers.getContractFactory("CredentialHook"))
      .connect(owner)
      .deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const usdc = await (await ethers.getContractFactory("MockUSDC")).connect(owner).deploy();
    await usdc.waitForDeployment();

    const oneMillion = ethers.parseUnits("1000000", 6);
    const actors = [client, judgeA, agentA, agentB, stranger];
    for (const signer of actors) {
      await usdc.connect(owner).mint(signer.address, oneMillion);
    }

    const job = await (await ethers.getContractFactory("ERC8183Job"))
      .connect(owner)
      .deploy(
        await hook.getAddress(),
        await usdc.getAddress(),
        await sourceRegistry.getAddress(),
        treasury.address,
        1000
      );
    await job.waitForDeployment();
    await hook.connect(owner).registerSourceContract(await job.getAddress(), true);

    for (const signer of actors) {
      await usdc.connect(signer).approve(await job.getAddress(), oneMillion);
    }

    const deadline = (await time.latest()) + 2 * 60 * 60;
    await job
      .connect(client)
      .createJob(
        "Submission Edit Task",
        "Editing deliverables before the deadline",
        deadline,
        ethers.parseUnits("100", 6),
        2
      );

    return { owner, client, judgeA, agentA, agentB, stranger, job, usdc };
  }

  async function submit(job: any, signer: any, link: string) {
    await job.connect(signer).submitDirect(0, link);
    const submission = await job.getSubmission(0, signer.address);
    return Number(submission.submissionId);
  }

  it("submitter can edit the deliverable link before the deadline", async function () {
    const { job, agentA } = await deployFixture();

    await submit(job, agentA, "https://example.com/v1");

    await expect(job.connect(agentA).updateDeliverable(0, "https://example.com/v2"))
      .to.emit(job, "DeliverableUpdated")
      .withArgs(0, agentA.address, "https://example.com/v2");

    const submission = await job.getSubmission(0, agentA.address);
    expect(submission.deliverableLink).to.equal("https://example.com/v2");
    expect(submission.agent).to.equal(agentA.address);
  });

  it("edit reverts after the deadline and for empty links", async function () {
    const { job, agentA } = await deployFixture();

    await submit(job, agentA, "https://example.com/v1");
    await expect(job.connect(agentA).updateDeliverable(0, "")).to.be.reverted;

    await time.increase(3 * 60 * 60);
    await expect(job.connect(agentA).updateDeliverable(0, "https://example.com/v2")).to.be.reverted;
  });

  it("only the submitter can edit; creator and judges cannot", async function () {
    const { job, client, judgeA, agentA, agentB, stranger } = await deployFixture();

    await submit(job, agentA, "https://example.com/v1");
    await job.connect(client).setJudges(0, [judgeA.address]);

    await expect(job.connect(agentB).updateDeliverable(0, "https://example.com/x")).to.be.reverted;
    await expect(job.connect(stranger).updateDeliverable(0, "https://example.com/x")).to.be.reverted;
    await expect(job.connect(client).updateDeliverable(0, "https://example.com/x")).to.be.reverted;
    await expect(job.connect(judgeA).updateDeliverable(0, "https://example.com/x")).to.be.reverted;

    // Judge appointed after submitting loses the ability to edit too.
    await job.connect(agentB).submitDirect(0, "https://example.com/b");
    await job.connect(client).setJudges(0, [agentB.address]);
    await expect(job.connect(agentB).updateDeliverable(0, "https://example.com/b2")).to.be.reverted;
  });

  it("judges cannot accept jobs or submit work", async function () {
    const { job, client, judgeA } = await deployFixture();

    await job.connect(client).setJudges(0, [judgeA.address]);

    await expect(job.connect(judgeA).acceptJob(0)).to.be.reverted;
    await expect(job.connect(judgeA).submitDirect(0, "https://example.com/j")).to.be.reverted;
    await expect(job.connect(judgeA).submitDeliverable(0, "https://example.com/j")).to.be.reverted;
  });

  it("editing clears review marks so judges re-review", async function () {
    const { job, client, judgeA, agentA } = await deployFixture();

    const submissionId = await submit(job, agentA, "https://example.com/v1");
    await job.connect(client).setJudges(0, [judgeA.address]);

    await job.connect(client).setReviewed(0, submissionId, true);
    await job.connect(judgeA).setReviewed(0, submissionId, true);
    expect(await job.isReviewed(0, submissionId, client.address)).to.equal(true);
    expect(await job.isReviewed(0, submissionId, judgeA.address)).to.equal(true);

    await job.connect(agentA).updateDeliverable(0, "https://example.com/v2");

    expect(await job.isReviewed(0, submissionId, client.address)).to.equal(false);
    expect(await job.isReviewed(0, submissionId, judgeA.address)).to.equal(false);
  });
});
