import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Judge triage: verdicts + promotion + reveal", function () {
  async function deployFixture(maxApprovals = 2) {
    const [owner, client, judgeA, judgeB, agentA, agentB, agentC, stranger, treasury] =
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
    const actors = [client, judgeA, judgeB, agentA, agentB, agentC, stranger];
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
        "Triage Task",
        "Accept / reject / promote workflow",
        deadline,
        ethers.parseUnits("100", 6),
        maxApprovals
      );
    await job.connect(client).setJudges(0, [judgeA.address, judgeB.address]);

    return { owner, client, judgeA, judgeB, agentA, agentB, agentC, stranger, job, usdc };
  }

  async function submit(job: any, signer: any, link: string) {
    await job.connect(signer).submitDirect(0, link);
    const submission = await job.getSubmission(0, signer.address);
    return Number(submission.submissionId);
  }

  it("only client and judges can set verdicts; bad inputs revert", async function () {
    const { job, client, judgeA, agentA, stranger } = await deployFixture();
    const sid = await submit(job, agentA, "https://example.com/a");

    await expect(job.connect(stranger).setReviewVerdict(0, sid, 1)).to.be.reverted;
    await expect(job.connect(judgeA).setReviewVerdict(0, 999999, 1)).to.be.reverted;
    await expect(job.connect(client).setReviewVerdict(0, sid, 3)).to.be.reverted;

    await expect(job.connect(judgeA).setReviewVerdict(0, sid, 1))
      .to.emit(job, "ReviewVerdictSet")
      .withArgs(0, sid, judgeA.address, 1);
    expect(await job.reviewVerdict(0, sid, judgeA.address)).to.equal(1);
    expect(await job.acceptCount(0, sid)).to.equal(1);
  });

  it("first accept locks the submission: reject can never follow", async function () {
    const { job, client, judgeA, judgeB, agentA } = await deployFixture();
    const sid = await submit(job, agentA, "https://example.com/a");

    await job.connect(judgeA).setReviewVerdict(0, sid, 1);

    await expect(job.connect(judgeB).setReviewVerdict(0, sid, 2)).to.be.reverted;
    await expect(job.connect(client).setReviewVerdict(0, sid, 2)).to.be.reverted;
    expect(await job.rejectCount(0, sid)).to.equal(0);
    expect(await job.acceptCount(0, sid)).to.equal(1);
  });

  it("reject is terminal: cannot be undone or outvoted", async function () {
    const { job, client, judgeA, judgeB, agentA } = await deployFixture();
    const sid = await submit(job, agentA, "https://example.com/a");

    await expect(job.connect(judgeA).setReviewVerdict(0, sid, 2))
      .to.emit(job, "ReviewVerdictSet")
      .withArgs(0, sid, judgeA.address, 2);
    expect(await job.rejectCount(0, sid)).to.equal(1);

    await expect(job.connect(judgeB).setReviewVerdict(0, sid, 1)).to.be.reverted;
    await expect(job.connect(client).setReviewVerdict(0, sid, 1)).to.be.reverted;
    await expect(job.connect(judgeA).setReviewVerdict(0, sid, 0)).to.be.reverted;
  });

  it("accepts are cumulative across judges and an accept can be undone until rejected", async function () {
    const { job, judgeA, judgeB, agentA } = await deployFixture();
    const sid = await submit(job, agentA, "https://example.com/a");

    await job.connect(judgeA).setReviewVerdict(0, sid, 1);
    await job.connect(judgeB).setReviewVerdict(0, sid, 1);
    expect(await job.acceptCount(0, sid)).to.equal(2);
    expect(await job.reviewVerdict(0, sid, judgeA.address)).to.equal(1);
    expect(await job.reviewVerdict(0, sid, judgeB.address)).to.equal(1);

    await job.connect(judgeA).setReviewVerdict(0, sid, 0);
    expect(await job.acceptCount(0, sid)).to.equal(1);

    // With no accepts left the reject path opens again.
    await job.connect(judgeB).setReviewVerdict(0, sid, 0);
    expect(await job.acceptCount(0, sid)).to.equal(0);
    await job.connect(judgeA).setReviewVerdict(0, sid, 2);
    expect(await job.rejectCount(0, sid)).to.equal(1);
  });

  it("promotion requires an accept; rejected submissions never promote", async function () {
    const { job, client, judgeA, agentA, agentB, stranger } = await deployFixture();
    const sidA = await submit(job, agentA, "https://example.com/a");
    const sidB = await submit(job, agentB, "https://example.com/b");

    await expect(job.connect(client).setPromoted(0, agentA.address, true)).to.be.reverted;
    await expect(job.connect(stranger).setPromoted(0, agentA.address, true)).to.be.reverted;
    await expect(job.connect(judgeA).setPromoted(0, judgeA.address, true)).to.be.reverted;

    await job.connect(client).setReviewVerdict(0, sidA, 1);
    await expect(job.connect(judgeA).setPromoted(0, agentA.address, true))
      .to.emit(job, "SubmissionPromoted")
      .withArgs(0, agentA.address, judgeA.address);
    expect(await job.isPromoted(0, agentA.address)).to.equal(true);
    expect(await job.isPromoted(0, agentB.address)).to.equal(false);
    await expect(job.connect(client).setPromoted(0, agentA.address, true)).to.be.reverted;

    await job.connect(judgeA).setReviewVerdict(0, sidB, 2);
    await expect(job.connect(client).setPromoted(0, agentB.address, true)).to.be.reverted;
  });

  it("promoted set is capped at maxApprovals + 5 and un-promote frees a slot", async function () {
    const { owner, job, client, usdc, agentA, agentB, agentC, stranger } =
      await deployFixture(1); // cap = 1 + 5 = 6
    const all = await ethers.getSigners();
    const extras = [all[9], all[10], all[11]];
    const oneMillion = ethers.parseUnits("1000000", 6);
    const jobAddress = await job.getAddress();
    for (const signer of extras) {
      await usdc.connect(owner).mint(signer.address, oneMillion);
      await usdc.connect(signer).approve(jobAddress, oneMillion);
    }

    const submitters = [agentA, agentB, agentC, stranger, ...extras]; // 7 submitters
    const sids: number[] = [];
    for (const [index, signer] of submitters.entries()) {
      sids.push(await submit(job, signer, `https://example.com/${index}`));
      await job.connect(client).setReviewVerdict(0, sids[index], 1);
    }

    const flags = async () =>
      Promise.all(submitters.map((signer) => job.isPromoted(0, signer.address)));

    for (let index = 0; index < 6; index++) {
      await job.connect(client).setPromoted(0, submitters[index].address, true);
    }
    await expect(job.connect(client).setPromoted(0, submitters[6].address, true)).to.be.reverted;
    expect((await flags()).filter(Boolean)).to.have.length(6);

    await expect(job.connect(client).setPromoted(0, submitters[0].address, false))
      .to.emit(job, "SubmissionUnpromoted")
      .withArgs(0, submitters[0].address, client.address);
    expect((await flags()).filter(Boolean)).to.have.length(5);
    expect(await job.isPromoted(0, submitters[0].address)).to.equal(false);

    await job.connect(client).setPromoted(0, submitters[6].address, true);
    expect((await flags()).filter(Boolean)).to.have.length(6);
  });

  it("selectFinalists only accepts promoted submissions and locks the promoted set", async function () {
    const { job, client, judgeA, agentA } = await deployFixture();
    const sid = await submit(job, agentA, "https://example.com/a");

    await job.connect(client).setReviewVerdict(0, sid, 1);
    await expect(job.connect(judgeA).selectFinalists(0, [agentA.address])).to.be.reverted;

    await job.connect(client).setPromoted(0, agentA.address, true);
    await job.connect(judgeA).selectFinalists(0, [agentA.address]);
    expect(await job.isInRevealPhase(0)).to.equal(true);

    await expect(job.connect(client).setPromoted(0, agentA.address, false)).to.be.reverted;
  });

  it("autoStartReveal starts with the promoted shortlist only", async function () {
    const { job, client, agentA, agentB, agentC, stranger } = await deployFixture();
    const sidA = await submit(job, agentA, "https://example.com/a");
    const sidB = await submit(job, agentB, "https://example.com/b");
    await submit(job, agentC, "https://example.com/c");

    // A: accepted but not promoted; B: accepted + promoted; C: untouched.
    await job.connect(client).setReviewVerdict(0, sidA, 1);
    await job.connect(client).setReviewVerdict(0, sidB, 1);
    await job.connect(client).setPromoted(0, agentB.address, true);

    await time.increase(3 * 60 * 60);
    await expect(job.connect(stranger).autoStartReveal(0)).to.emit(job, "AutoRevealStarted");

    expect(await job.getSelectedFinalists(0)).to.deep.equal([agentB.address]);
    expect(await job.isFinalist(0, agentA.address)).to.equal(false);
    expect(await job.isFinalist(0, agentC.address)).to.equal(false);
  });

  it("autoStartReveal skips rejected submissions when nothing is promoted", async function () {
    const { job, client, agentA, agentB, stranger } = await deployFixture();
    const sidA = await submit(job, agentA, "https://example.com/a");
    await submit(job, agentB, "https://example.com/b");

    await job.connect(client).setReviewVerdict(0, sidA, 2);

    await time.increase(3 * 60 * 60);
    await job.connect(stranger).autoStartReveal(0);

    expect(await job.getSelectedFinalists(0)).to.deep.equal([agentB.address]);
  });

  it("autoStartReveal reverts when every submission was rejected", async function () {
    const { job, client, agentA, stranger } = await deployFixture();
    const sid = await submit(job, agentA, "https://example.com/a");
    await job.connect(client).setReviewVerdict(0, sid, 2);

    await time.increase(3 * 60 * 60);
    await expect(job.connect(stranger).autoStartReveal(0)).to.be.reverted;
  });

  it("full workflow: accept -> promote -> begin reveal -> finalize winners", async function () {
    const { job, client, judgeA, agentA, agentB } = await deployFixture();
    const sidA = await submit(job, agentA, "https://example.com/a");
    const sidB = await submit(job, agentB, "https://example.com/b");

    // Triage: both judged acceptable, then the team promotes one.
    await job.connect(client).setReviewVerdict(0, sidA, 1);
    await job.connect(judgeA).setReviewVerdict(0, sidA, 1);
    await job.connect(client).setReviewVerdict(0, sidB, 1);
    await job.connect(client).setPromoted(0, agentA.address, true);

    // Explicit begin-reveal with the promoted list.
    await job.connect(judgeA).selectFinalists(0, [agentA.address]);
    expect(await job.isInRevealPhase(0)).to.equal(true);

    await time.increase(5 * 24 * 60 * 60 + 1);
    await job
      .connect(client)
      .finalizeWinners(0, [agentA.address], [ethers.parseUnits("100", 6)]);

    const submission = await job.getSubmission(0, agentA.address);
    expect(Number(submission.status)).to.equal(2); // Approved
    expect(await job.isFinalist(0, agentB.address)).to.equal(false);
  });
});
