import { expect } from "chai";
import { acceptAndPromote } from "./helpers/reviewFlow";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const FIVE_DAYS = 5 * 24 * 60 * 60;

describe("Judge Access + Reviewed Flags", function () {
  async function deployFixture() {
    const [owner, client, judgeA, judgeB, agentA, agentB, stranger, treasury] =
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
    const actors = [client, judgeA, judgeB, agentA, agentB, stranger];
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
        "Judge Access Task",
        "Testing judge delegation and review flags",
        deadline,
        ethers.parseUnits("100", 6),
        2
      );

    return { owner, client, judgeA, judgeB, agentA, agentB, stranger, job, usdc };
  }

  async function submit(job: any, signer: any, link: string) {
    await job.connect(signer).submitDirect(0, link);
    const submission = await job.getSubmission(0, signer.address);
    return Number(submission.submissionId);
  }

  it("client manages judges; non-clients cannot", async function () {
    const { job, client, judgeA, judgeB, stranger } = await deployFixture();

    await expect(job.connect(stranger).setJudges(0, [judgeA.address]))
      .to.be.reverted;

    await job.connect(client).setJudges(0, [judgeA.address, judgeB.address]);

    expect(await job.isJudge(0, judgeA.address)).to.equal(true);
    expect(await job.isJudge(0, judgeB.address)).to.equal(true);
    expect(await job.isJudge(0, stranger.address)).to.equal(false);

    const judges = await job.getJudges(0);
    expect(judges).to.deep.equal([judgeA.address, judgeB.address]);
  });

  it("setJudges replaces the previous list (revocation works)", async function () {
    const { job, client, judgeA, judgeB } = await deployFixture();

    await job.connect(client).setJudges(0, [judgeA.address, judgeB.address]);
    await job.connect(client).setJudges(0, [judgeB.address]);

    expect(await job.isJudge(0, judgeA.address)).to.equal(false);
    expect(await job.isJudge(0, judgeB.address)).to.equal(true);
    expect(await job.getJudges(0)).to.deep.equal([judgeB.address]);
  });

  it("setJudges rejects invalid entries", async function () {
    const { job, client, judgeA } = await deployFixture();

    await expect(
      job.connect(client).setJudges(0, [ethers.ZeroAddress])
    ).to.be.reverted;

    await expect(
      job.connect(client).setJudges(0, [judgeA.address, judgeA.address])
    ).to.be.reverted;

    await expect(job.connect(client).setJudges(0, [client.address])).to.be.reverted;

    const ten = Array.from({ length: 11 }, (_, i) =>
      ethers.getAddress(`0x${(i + 1).toString().padStart(40, "0")}`)
    );
    await expect(job.connect(client).setJudges(0, ten)).to.be.reverted;
  });

  it("judge can selectFinalists and open the reveal phase; strangers cannot", async function () {
    const { job, client, judgeA, agentA, stranger } = await deployFixture();

    await submit(job, agentA, "https://example.com/a");

    await expect(job.connect(stranger).selectFinalists(0, [agentA.address], FIVE_DAYS))
      .to.be.reverted;

    await job.connect(client).setJudges(0, [judgeA.address]);
    await acceptAndPromote(job, client, 0, [agentA.address]);
    await job.connect(judgeA).selectFinalists(0, [agentA.address], FIVE_DAYS);

    expect(await job.isFinalist(0, agentA.address)).to.equal(true);
    const status = (await job.getJob(0)).status;
    expect(Number(status)).to.equal(4); // RevealPhase
    expect(Number(await job.getRevealPhaseEnd(0))).to.be.greaterThan(0);
  });

  it("revoked judge loses selectFinalists permission", async function () {
    const { job, client, judgeA, agentA } = await deployFixture();

    await submit(job, agentA, "https://example.com/a");
    await job.connect(client).setJudges(0, [judgeA.address]);
    await job.connect(client).setJudges(0, []);

    await expect(job.connect(judgeA).selectFinalists(0, [agentA.address], FIVE_DAYS))
      .to.be.reverted;
  });

  it("selectFinalists honors a chosen reveal duration and enforces bounds", async function () {
    const { job, client, agentA } = await deployFixture();
    const oneDay = 24 * 60 * 60;

    await submit(job, agentA, "https://example.com/a");
    await acceptAndPromote(job, client, 0, [agentA.address]);

    await expect(
      job.connect(client).selectFinalists(0, [agentA.address], oneDay / 2)
    ).to.be.reverted;
    await expect(
      job.connect(client).selectFinalists(0, [agentA.address], 8 * 24 * 60 * 60)
    ).to.be.reverted;

    await job.connect(client).selectFinalists(0, [agentA.address], oneDay);
    const start = Number(await job.revealPhaseStart(0));
    const end = Number(await job.revealPhaseEnd(0));
    expect(end - start).to.equal(oneDay);
    expect(await job.isInRevealPhase(0)).to.equal(true);
  });

  it("autoStartReveal keeps the fixed five-day window", async function () {
    const { job, client, agentA } = await deployFixture();

    await submit(job, agentA, "https://example.com/a");
    await acceptAndPromote(job, client, 0, [agentA.address]);

    await time.increase(3 * 60 * 60);
    await expect(job.connect(client).autoStartReveal(0)).to.emit(job, "AutoRevealStarted");

    const start = Number(await job.revealPhaseStart(0));
    const end = Number(await job.revealPhaseEnd(0));
    expect(end - start).to.equal(FIVE_DAYS);
  });

  it("creator and judge can setReviewed; strangers cannot; un-review works", async function () {
    const { job, client, judgeA, agentA, stranger } = await deployFixture();

    const submissionId = await submit(job, agentA, "https://example.com/a");

    await expect(
      job.connect(stranger).setReviewed(0, submissionId, true)
    ).to.be.reverted;

    await job.connect(client).setJudges(0, [judgeA.address]);

    await job.connect(judgeA).setReviewed(0, submissionId, true);
    expect(await job.isReviewed(0, submissionId, judgeA.address)).to.equal(true);
    // creator's list is independent
    expect(await job.isReviewed(0, submissionId, client.address)).to.equal(false);

    await job.connect(client).setReviewed(0, submissionId, true);
    expect(await job.isReviewed(0, submissionId, client.address)).to.equal(true);

    await job.connect(judgeA).setReviewed(0, submissionId, false);
    expect(await job.isReviewed(0, submissionId, judgeA.address)).to.equal(false);
  });

  it("setReviewed rejects submissions belonging to another task", async function () {
    const { job, client, agentA } = await deployFixture();

    const submissionId = await submit(job, agentA, "https://example.com/a");

    await expect(job.connect(client).setReviewed(1, submissionId, true)).to.be.reverted;
    await expect(job.connect(client).setReviewed(0, 999999, true)).to.be.reverted;
  });

  it("critiques are once per submission while build-ons spend the once-per-task slot", async function () {
    const { job, client, judgeA, judgeB, agentA, agentB, stranger, owner } = await deployFixture();

    const submissionId = await submit(job, agentA, "https://example.com/a");
    const submissionB = await submit(job, stranger, "https://example.com/b");
    // A third, never-critiqued target so the build-on slot can be exercised
    // independently of the critique rules.
    const submissionC = await submit(job, owner, "https://example.com/c");
    await job.connect(client).setJudges(0, [judgeA.address]);
    await acceptAndPromote(job, client, 0, [agentA.address, stranger.address, owner.address]);
    await job
      .connect(judgeA)
      .selectFinalists(0, [agentA.address, stranger.address, owner.address], FIVE_DAYS);

    // Critique: once per submission, independent across finalists.
    await job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://critique-1");
    expect(await job.hasCritiqued(submissionId, agentB.address)).to.equal(true);
    await expect(
      job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://critique-again")
    ).to.be.reverted;
    await job.connect(agentB).respondToSubmission(submissionB, 1, "ipfs://critique-b");
    expect(await job.hasCritiqued(submissionB, agentB.address)).to.equal(true);

    // Both directions are blocked: no building on a submission you critiqued.
    // (The build-on slot is still free here, so only the critique rule fires.)
    await expect(
      job.connect(agentB).respondToSubmission(submissionId, 0, "ipfs://build-on-a")
    ).to.be.reverted;
    await expect(
      job.connect(agentB).respondToSubmission(submissionB, 0, "ipfs://build-on-b")
    ).to.be.reverted;

    // Build-on/alternative: one priced slot per task, spent on a fresh target -
    // and critiques did not spend it.
    await job.connect(agentB).respondToSubmission(submissionC, 0, "ipfs://build-on");
    expect(await job.hasResponded(0, agentB.address)).to.equal(true);
    await expect(
      job.connect(agentB).respondToSubmission(submissionB, 0, "ipfs://build-again")
    ).to.be.reverted;
    await expect(
      job.connect(agentB).respondToSubmission(submissionB, 2, "ipfs://alternative")
    ).to.be.reverted;

    // A different wallet still gets its own single interaction: judgeB has not
    // critiqued submissionB and has a fresh slot, so its build-on succeeds.
    await job.connect(judgeB).respondToSubmission(submissionB, 0, "ipfs://second-wallet");
    expect(await job.hasResponded(0, judgeB.address)).to.equal(true);
  });
});
