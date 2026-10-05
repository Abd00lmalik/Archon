import { expect } from "chai";
import { acceptAndPromote } from "./helpers/reviewFlow";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const FIVE_DAYS = 5 * 24 * 60 * 60;

describe("Submission Relationships", function () {
  async function deployFixture() {
    const [owner, client, agentA, agentB, agentC, treasury, ...others] = await ethers.getSigners();

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
    await usdc.connect(owner).mint(agentC.address, oneMillion);
    for (const signer of others.slice(0, 12)) {
      await usdc.connect(owner).mint(signer.address, oneMillion);
    }

    const job = await (await ethers.getContractFactory("ERC8183Job"))
      .connect(owner)
      .deploy(await hook.getAddress(), await usdc.getAddress(), await sourceRegistry.getAddress(), treasury.address, 1000);
    await job.waitForDeployment();
    await hook.connect(owner).registerSourceContract(await job.getAddress(), true);

    await usdc.connect(client).approve(await job.getAddress(), oneMillion);
    await usdc.connect(agentA).approve(await job.getAddress(), oneMillion);
    await usdc.connect(agentB).approve(await job.getAddress(), oneMillion);
    await usdc.connect(agentC).approve(await job.getAddress(), oneMillion);
    for (const signer of others.slice(0, 12)) {
      await usdc.connect(signer).approve(await job.getAddress(), oneMillion);
    }

    return { owner, client, agentA, agentB, agentC, treasury, others, job, usdc };
  }

  async function createJob(job: any, client: any) {
    const deadline = (await time.latest()) + 2 * 60 * 60;
    await job
      .connect(client)
      .createJob("Build Parsing Tool", "Analyze logs and return structured output", deadline, ethers.parseUnits("300", 6), 3);
    return deadline;
  }

  async function submitBaseSubmission(job: any, agent: any) {
    await job.connect(agent).acceptJob(0);
    await job.connect(agent).submitDeliverable(0, "https://example.com/base-submission");
    const submission = await job.getSubmission(0, agent.address);
    return Number(submission.submissionId);
  }

  async function enterRevealPhase(job: any, client: any, finalists: string[]) {
    await acceptAndPromote(job, client, 0, finalists);
    await job.connect(client).selectFinalists(0, finalists, FIVE_DAYS);
  }

  it("only client can selectFinalists", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);
    await submitBaseSubmission(job, agentA);

    await expect(job.connect(agentB).selectFinalists(0, [agentA.address], FIVE_DAYS)).to.be.reverted;
  });

  it("only submitted agents can be selected as finalists", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);
    await submitBaseSubmission(job, agentA);
    await job.connect(agentB).acceptJob(0);
    await acceptAndPromote(job, client, 0, [agentA.address]);

    await expect(job.connect(client).selectFinalists(0, [agentA.address, agentB.address], FIVE_DAYS)).to.be.reverted;
  });

  it("responder can build on an existing finalist submission", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await enterRevealPhase(job, client, [agentA.address]);

    await expect(job.connect(agentB).respondToSubmission(submissionId, 0, "ipfs://builds-on")).to.emit(
      job,
      "SubmissionResponseAdded"
    );
  });

  it("responder can critique an existing finalist submission", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await enterRevealPhase(job, client, [agentA.address]);

    await job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://critique");
    const ids = await job.getSubmissionResponses(submissionId);
    const response = await job.getResponse(ids[0]);
    expect(response.responseType).to.equal(1);
  });

  it("responder can submit alternative to existing finalist submission", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await enterRevealPhase(job, client, [agentA.address]);

    await job.connect(agentB).respondToSubmission(submissionId, 2, "ipfs://alternative");
    const ids = await job.getSubmissionResponses(submissionId);
    const response = await job.getResponse(ids[0]);
    expect(response.responseType).to.equal(2);
  });

  it("respondToSubmission reverts outside reveal phase", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);

    await expect(job.connect(agentB).respondToSubmission(submissionId, 0, "ipfs://too-early")).to.be.reverted;
  });

  it("respondToSubmission reverts for non-finalist submissions", async function () {
    const { job, client, agentA, agentB, agentC } = await deployFixture();
    await createJob(job, client);
    const submissionAId = await submitBaseSubmission(job, agentA);
    await submitBaseSubmission(job, agentC);
    await enterRevealPhase(job, client, [agentC.address]);

    await expect(job.connect(agentB).respondToSubmission(submissionAId, 0, "ipfs://not-finalist")).to.be.reverted;
  });

  it("submitter cannot respond to their own submission", async function () {
    const { job, client, agentA } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await enterRevealPhase(job, client, [agentA.address]);

    await expect(job.connect(agentA).respondToSubmission(submissionId, 0, "ipfs://self")).to.be.reverted;
  });

  it("build-on slot is once per job while critiques stay per submission", async function () {
    const { job, client, agentA, agentB, agentC } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    const otherSubmissionId = await submitBaseSubmission(job, agentC);
    await enterRevealPhase(job, client, [agentA.address, agentC.address]);

    await job.connect(agentB).respondToSubmission(submissionId, 0, "ipfs://first");
    // Build-on/alternative spent the once-per-job slot: not again on either finalist.
    await expect(
      job.connect(agentB).respondToSubmission(otherSubmissionId, 0, "ipfs://other-finalist")
    ).to.be.reverted;
    await expect(
      job.connect(agentB).respondToSubmission(otherSubmissionId, 2, "ipfs://alternative")
    ).to.be.reverted;
    expect(await job.hasResponded(0, agentB.address)).to.equal(true);

    // One-directional gate: a wallet that built on a submission cannot also
    // critique it, but critiques of other finalists remain open.
    await expect(
      job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://critique-same")
    ).to.be.reverted;
    await job.connect(agentB).respondToSubmission(otherSubmissionId, 1, "ipfs://critique-other");
    expect(await job.hasCritiqued(otherSubmissionId, agentB.address)).to.equal(true);
    expect(await job.hasCritiqued(submissionId, agentB.address)).to.equal(false);
    await expect(
      job.connect(agentB).respondToSubmission(otherSubmissionId, 1, "ipfs://critique-again")
    ).to.be.reverted;

    // Other wallets still get their own critique allowance.
    await job.connect(agentC).respondToSubmission(submissionId, 1, "ipfs://from-agent-c");
    expect(await job.hasCritiqued(submissionId, agentC.address)).to.equal(true);
    expect(await job.hasResponded(0, agentC.address)).to.equal(false);
  });

  it("alternatives block a critique of the target; critique-then-build-on is blocked too", async function () {
    const { job, client, agentA, agentB, agentC, others } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    const otherSubmissionId = await submitBaseSubmission(job, agentC);
    // A third finalist keeps a legal build-on target available after the
    // same-target pair gets blocked.
    await job.connect(others[0]).acceptJob(0);
    await job.connect(others[0]).submitDeliverable(0, "https://example.com/third");
    const thirdSubmissionId = Number(
      (await job.getSubmission(0, others[0].address)).submissionId
    );
    await enterRevealPhase(job, client, [
      agentA.address,
      agentC.address,
      others[0].address
    ]);

    // An alternative on `otherSubmissionId` blocks a critique of it...
    await job.connect(agentB).respondToSubmission(otherSubmissionId, 2, "ipfs://alternative");
    expect(await job.pricedSlotTarget(0, agentB.address)).to.equal(otherSubmissionId);
    await expect(
      job.connect(agentB).respondToSubmission(otherSubmissionId, 1, "ipfs://critique-after-alt")
    ).to.be.reverted;
    // ...but not a critique of a different finalist.
    await job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://critique-other");
    expect(await job.hasCritiqued(submissionId, agentB.address)).to.equal(true);

    // Critique -> build-on on the SAME submission is blocked: both directions
    // of the mutual exclusion now hold.
    await job.connect(agentA).respondToSubmission(otherSubmissionId, 1, "ipfs://critique-first");
    await expect(
      job.connect(agentA).respondToSubmission(otherSubmissionId, 0, "ipfs://builds-after-critique")
    ).to.be.reverted;
    expect(await job.hasResponded(0, agentA.address)).to.equal(false);

    // The critique did not spend the build-on slot: a different, un-critiqued
    // target still works.
    await job.connect(agentA).respondToSubmission(thirdSubmissionId, 0, "ipfs://builds-on-third");
    expect(await job.hasResponded(0, agentA.address)).to.equal(true);
    expect(await job.pricedSlotTarget(0, agentA.address)).to.equal(thirdSubmissionId);
  });

  it("responding requires 2 USDC stake", async function () {
    const { job, client, agentA, agentB, usdc } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await enterRevealPhase(job, client, [agentA.address]);

    await usdc.connect(agentB).approve(await job.getAddress(), 0);
    await expect(job.connect(agentB).respondToSubmission(submissionId, 0, "ipfs://needs-stake")).to.be.reverted;
  });

  it("stake returned after 7 days post-deadline", async function () {
    const { job, client, agentA, agentB, usdc } = await deployFixture();
    const deadline = await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await enterRevealPhase(job, client, [agentA.address]);

    await job.connect(agentB).respondToSubmission(submissionId, 0, "ipfs://stake-return");
    const ids = await job.getSubmissionResponses(submissionId);
    const responseId = ids[0];

    await expect(job.connect(agentB).returnResponseStake(responseId)).to.be.reverted;
    await time.increaseTo(deadline + 7 * 24 * 60 * 60 + 1);
    const before = await usdc.balanceOf(agentB.address);
    await job.connect(agentB).returnResponseStake(responseId);
    const after = await usdc.balanceOf(agentB.address);
    expect(after - before).to.equal(ethers.parseUnits("2", 6));
  });

  it("creator can slash response stake - 50% slashed", async function () {
    const { job, client, agentA, agentB, usdc, treasury } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await enterRevealPhase(job, client, [agentA.address]);

    await job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://slash-me");
    const ids = await job.getSubmissionResponses(submissionId);
    const responseId = ids[0];

    const treasuryBefore = await usdc.balanceOf(treasury.address);
    const responderBefore = await usdc.balanceOf(agentB.address);

    await job.connect(client).slashResponseStake(responseId);

    const treasuryAfter = await usdc.balanceOf(treasury.address);
    const responderAfter = await usdc.balanceOf(agentB.address);
    expect(treasuryAfter - treasuryBefore).to.equal(ethers.parseUnits("1", 6));
    expect(responderAfter - responderBefore).to.equal(ethers.parseUnits("1", 6));
  });

  it("finalizeWinners reverts before reveal phase ends", async function () {
    const { job, client, agentA } = await deployFixture();
    await createJob(job, client);
    await submitBaseSubmission(job, agentA);
    await enterRevealPhase(job, client, [agentA.address]);

    await expect(
      job.connect(client).finalizeWinners(0, [agentA.address], [ethers.parseUnits("100", 6)])
    ).to.be.reverted;
  });

  it("finalizeWinners only accepts finalists as winners", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);
    await submitBaseSubmission(job, agentA);
    await submitBaseSubmission(job, agentB);
    await enterRevealPhase(job, client, [agentA.address]);

    const revealEnd = Number(await job.getRevealPhaseEnd(0));
    await time.increaseTo(revealEnd + 1);

    await expect(
      job.connect(client).finalizeWinners(0, [agentB.address], [ethers.parseUnits("100", 6)])
    ).to.be.reverted;
  });

  it("finalizeWinners approves finalists after reveal and allocates rewards", async function () {
    const { job, client, agentA } = await deployFixture();
    await createJob(job, client);
    await submitBaseSubmission(job, agentA);
    await enterRevealPhase(job, client, [agentA.address]);

    const revealEnd = Number(await job.getRevealPhaseEnd(0));
    await time.increaseTo(revealEnd + 1);

    await expect(
      job.connect(client).finalizeWinners(0, [agentA.address], [ethers.parseUnits("100", 6)])
    ).to.emit(job, "WinnersFinalized");

    const submission = await job.getSubmission(0, agentA.address);
    expect(submission.status).to.equal(2); // SubmissionStatus.Approved
  });

  it("submitDirect allows submit without prior acceptJob", async function () {
    const { job, client, agentA } = await deployFixture();
    await createJob(job, client);

    await expect(job.connect(agentA).submitDirect(0, "https://example.com/direct")).to.emit(job, "DeliverableSubmitted");
    expect(await job.isAccepted(0, agentA.address)).to.equal(true);

    const submission = await job.getSubmission(0, agentA.address);
    expect(submission.agent).to.equal(agentA.address);
    expect(submission.status).to.equal(1); // SubmissionStatus.Submitted
  });

  it("creator cannot call submitDirect on own task", async function () {
    const { job, client } = await deployFixture();
    await createJob(job, client);
    await expect(job.connect(client).submitDirect(0, "https://example.com/nope")).to.be.reverted;
  });

  it("submitDirect reverts after deadline and on duplicate submit", async function () {
    const { job, client, agentA } = await deployFixture();
    const deadline = await createJob(job, client);

    await job.connect(agentA).submitDirect(0, "https://example.com/once");
    await expect(job.connect(agentA).submitDirect(0, "https://example.com/twice")).to.be.reverted;

    await time.increaseTo(deadline + 1);
    await expect(job.connect(client).submitDirect(0, "https://example.com/late")).to.be.reverted;
    await expect(job.connect(agentA).submitDirect(0, "https://example.com/late")).to.be.reverted;
  });

  it("getSubmissions returns the canonical submitted-agent index in review phase", async function () {
    const { job, client, agentA, agentB, agentC } = await deployFixture();
    await createJob(job, client);
    await submitBaseSubmission(job, agentA);
    await submitBaseSubmission(job, agentB);

    const creatorView = await job.connect(client).getSubmissions(0);
    expect(creatorView.length).to.equal(2);

    const nonCreatorView = await job.connect(agentC).getSubmissions(0);
    expect(nonCreatorView.length).to.equal(2);
  });

  it("getSubmissions keeps non-finalists visible for auditability after reveal", async function () {
    const { job, client, agentA, agentB, agentC } = await deployFixture();
    await createJob(job, client);
    await submitBaseSubmission(job, agentA);
    await submitBaseSubmission(job, agentB);
    await enterRevealPhase(job, client, [agentA.address]);

    const visible = await job.connect(agentC).getSubmissions(0);
    expect(visible.length).to.equal(2);
    expect(visible[0].agent).to.equal(agentA.address);
  });

  it("build-on author who wins keeps the full prize when nobody built on them", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);

    const parentSubmissionId = await submitBaseSubmission(job, agentA);
    await submitBaseSubmission(job, agentB);
    await enterRevealPhase(job, client, [agentA.address, agentB.address]);

    await job.connect(agentB).respondToSubmission(parentSubmissionId, 0, "ipfs://build-on-proof");

    const revealEnd = Number(await job.getRevealPhaseEnd(0));
    await time.increaseTo(revealEnd + 1);
    await job.connect(client).finalizeWinners(0, [agentB.address], [ethers.parseUnits("100", 6)]);

    const parent = await job.getSubmission(0, agentA.address);
    const buildOn = await job.getSubmission(0, agentB.address);
    // Nobody built on the winner's submission: 100% of the prize, no pot reserved.
    expect(buildOn.allocatedReward).to.equal(ethers.parseUnits("100", 6));
    expect(buildOn.isBuildOnWinner).to.equal(true);
    expect(parent.allocatedReward).to.equal(0);
    expect(parent.buildOnBonus).to.equal(0);
  });

  it("autoStartReveal works after deadline when submissions are under threshold", async function () {
    const { job, client, agentA, agentB, agentC } = await deployFixture();
    const deadline = await createJob(job, client);

    await job.connect(agentA).submitDirect(0, "https://example.com/a");
    await job.connect(agentB).submitDirect(0, "https://example.com/b");

    await time.increaseTo(deadline + 1);

    await expect(job.connect(agentC).autoStartReveal(0)).to.emit(job, "AutoRevealStarted");
    expect(await job.isInRevealPhase(0)).to.equal(true);

    const finalists = await job.getSelectedFinalists(0);
    expect(finalists.length).to.equal(2);
    expect(finalists).to.include(agentA.address);
    expect(finalists).to.include(agentB.address);
  });

  it("autoStartReveal reverts before deadline", async function () {
    const { job, client, agentA } = await deployFixture();
    await createJob(job, client);
    await job.connect(agentA).submitDirect(0, "https://example.com/a");

    await expect(job.connect(agentA).autoStartReveal(0)).to.be.reverted;
  });

  it("autoStartReveal reverts when submissions exceed maxApprovals + 5", async function () {
    const { job, client, others } = await deployFixture();
    const deadline = await createJob(job, client);

    const participants = others.slice(0, 9);
    expect(participants.length).to.equal(9);

    for (const signer of participants) {
      await job.connect(signer).submitDirect(0, `https://example.com/${signer.address}`);
    }

    await time.increaseTo(deadline + 1);
    await expect(job.connect(participants[0]).autoStartReveal(0)).to.be.reverted;
  });
});
