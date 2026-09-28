import { expect } from "chai";
import { acceptAndPromote } from "./helpers/reviewFlow";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Interaction Economy", function () {
  async function deployFixture() {
    const [owner, client, agentA, agentB, agentC, treasury, ...others] = await ethers.getSigners();

    const sourceRegistry = await (await ethers.getContractFactory("SourceRegistry")).connect(owner).deploy();
    await sourceRegistry.waitForDeployment();

    const registry = await (await ethers.getContractFactory("ERC8004ValidationRegistry")).connect(owner).deploy();
    await registry.waitForDeployment();

    const hook = await (await ethers.getContractFactory("CredentialHook"))
      .connect(owner)
      .deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const usdc = await (await ethers.getContractFactory("MockUSDC")).connect(owner).deploy();
    await usdc.waitForDeployment();

    const oneMillion = ethers.parseUnits("1000000", 6);
    for (const signer of [client, agentA, agentB, agentC, treasury, ...others]) {
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

    for (const signer of [client, agentA, agentB, agentC, ...others]) {
      await usdc.connect(signer).approve(await job.getAddress(), oneMillion);
    }

    return { owner, client, agentA, agentB, agentC, treasury, others, job, usdc };
  }

  async function createJobWithEconomy(
    job: any,
    client: any,
    {
      reward = "200",
      maxApprovals = 3,
      interactionStake = ethers.parseUnits("2", 6),
      interactionPoolPercent = 1000
    }: {
      reward?: string;
      maxApprovals?: number;
      interactionStake?: bigint;
      interactionPoolPercent?: number;
    } = {}
  ) {
    const deadline = (await time.latest()) + 2 * 60 * 60;
    await job
      .connect(client)
      .createJob(
        "Interaction Economy Task",
        "Test reveal-phase micro-payments",
        deadline,
        ethers.parseUnits(reward, 6),
        maxApprovals,
        interactionStake,
        interactionPoolPercent
      );
    return deadline;
  }

  async function createClassicJob(job: any, client: any, reward = "200", maxApprovals = 3) {
    const deadline = (await time.latest()) + 2 * 60 * 60;
    await job
      .connect(client)
      .createJob(
        "Classic Task",
        "Backward-compatible createJob path",
        deadline,
        ethers.parseUnits(reward, 6),
        maxApprovals
      );
    return deadline;
  }

  async function submit(job: any, signer: any, link: string) {
    await job.connect(signer).submitDirect(0, link);
    const submission = await job.getSubmission(0, signer.address);
    return Number(submission.submissionId);
  }

  async function enterReveal(job: any, client: any, finalists: string[]) {
    await acceptAndPromote(job, client, 0, finalists);
    await job.connect(client).selectFinalists(0, finalists);
  }

  it("createJob with interaction pool allocates correctly", async function () {
    const { job, client, usdc } = await deployFixture();
    await createJobWithEconomy(job, client, {
      reward: "100",
      maxApprovals: 2,
      interactionStake: ethers.parseUnits("1.5", 6),
      interactionPoolPercent: 1500
    });

    const economy = await job.getTaskEconomy(0);
    const contractBalance = await usdc.balanceOf(await job.getAddress());

    expect(economy.interactionStake).to.equal(ethers.parseUnits("1.5", 6));
    expect(economy.interactionPool).to.equal(ethers.parseUnits("15", 6));
    expect(economy.interactionReward).to.equal(ethers.parseUnits("0.75", 6));
    expect(economy.interactionPoolFunded).to.equal(true);
    expect(contractBalance).to.equal(ethers.parseUnits("115", 6));
  });

  it("respondToSubmission uses task-specific stake amount", async function () {
    const { job, client, agentA, agentB, usdc } = await deployFixture();
    await createJobWithEconomy(job, client, {
      interactionStake: ethers.parseUnits("3", 6),
      interactionPoolPercent: 1200
    });
    const submissionId = await submit(job, agentA, "https://example.com/base");
    await enterReveal(job, client, [agentA.address]);

    const before = await usdc.balanceOf(agentB.address);
    await job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://critique");
    const after = await usdc.balanceOf(agentB.address);

    expect(before - after).to.equal(ethers.parseUnits("3", 6));

    const ids = await job.getSubmissionResponses(submissionId);
    const response = await job.getResponse(ids[0]);
    expect(response.stakedAmount).to.equal(ethers.parseUnits("3", 6));
  });

  it("respondWithAuthorization stakes with EIP-3009 and records responder as payer", async function () {
    const { job, client, agentA, agentB, agentC, usdc } = await deployFixture();
    await createJobWithEconomy(job, client, {
      interactionStake: ethers.parseUnits("2.5", 6),
      interactionPoolPercent: 1000
    });
    const submissionId = await submit(job, agentA, "https://example.com/base");
    await enterReveal(job, client, [agentA.address]);

    const stake = ethers.parseUnits("2.5", 6);
    const now = await time.latest();
    const validAfter = now - 60;
    const validBefore = now + 3600;
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const verifyingContract = await usdc.getAddress();
    const jobAddress = await job.getAddress();
    const signature = await agentB.signTypedData(
      {
        name: await usdc.name(),
        version: await usdc.version(),
        chainId,
        verifyingContract
      },
      {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" }
        ]
      },
      {
        from: agentB.address,
        to: jobAddress,
        value: stake,
        validAfter,
        validBefore,
        nonce
      }
    );
    const { v, r, s } = ethers.Signature.from(signature);

    const before = await usdc.balanceOf(agentB.address);
    await expect(
      job
        .connect(agentC)
        .respondWithAuthorization(
          submissionId,
          1,
          "ipfs://authorized-critique",
          agentB.address,
          jobAddress,
          stake,
          validAfter,
          validBefore,
          nonce,
          v,
          r,
          s
        )
    ).to.emit(job, "SubmissionResponseAdded");

    const after = await usdc.balanceOf(agentB.address);
    const responseId = (await job.getSubmissionResponses(submissionId))[0];
    const response = await job.getResponse(responseId);

    expect(before - after).to.equal(stake);
    expect(response.responder).to.equal(agentB.address);
    expect(response.stakedAmount).to.equal(stake);
    expect(await job.hasResponded(0, agentB.address)).to.equal(true);
    // Every new response joins the equal-split pool.
    expect(await job.unclaimedResponseCount(0)).to.equal(1);
  });

  it("claimInteractionReward pays after finalization", async function () {
    const { job, client, agentA, agentB, treasury, usdc } = await deployFixture();
    await createJobWithEconomy(job, client, {
      reward: "200",
      interactionPoolPercent: 1000
    });
    const submissionId = await submit(job, agentA, "https://example.com/finalist");
    await enterReveal(job, client, [agentA.address]);

    await job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://rewarded-critique");
    const responseId = (await job.getSubmissionResponses(submissionId))[0];

    const revealEnd = Number(await job.getRevealPhaseEnd(0));
    await time.increaseTo(revealEnd + 1);
    await job.connect(client).finalizeWinners(0, [agentA.address], [ethers.parseUnits("120", 6)]);

    const economy = await job.getTaskEconomy(0);
    // Sole responder: the entire pool is their share.
    const share = economy.interactionPool;
    const fee = (share * 1000n) / 10000n;
    const payout = share - fee;

    const responderBefore = await usdc.balanceOf(agentB.address);
    const treasuryBefore = await usdc.balanceOf(treasury.address);

    await expect(job.connect(agentB).claimInteractionReward(responseId))
      .to.emit(job, "InteractionRewardClaimed")
      .withArgs(responseId, agentB.address, payout);

    const responderAfter = await usdc.balanceOf(agentB.address);
    const treasuryAfter = await usdc.balanceOf(treasury.address);
    const response = await job.getResponse(responseId);

    expect(responderAfter - responderBefore).to.equal(payout + response.stakedAmount);
    expect(treasuryAfter - treasuryBefore).to.equal(fee);
    expect(response.interactionRewardClaimed).to.equal(true);
    expect(response.stakeReturned).to.equal(true);
    expect(await job.unclaimedResponseCount(0)).to.equal(0);
    expect(await job.getInteractionPoolRemaining(0)).to.equal(0);
  });

  it("settleRevealPhase returns stakes and pays rewards in a batch", async function () {
    const { job, client, agentA, agentB, treasury, usdc } = await deployFixture();
    await createJobWithEconomy(job, client, {
      reward: "200",
      interactionPoolPercent: 1000
    });
    const submissionId = await submit(job, agentA, "https://example.com/finalist");
    await enterReveal(job, client, [agentA.address]);
    await job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://batch-critique");
    const responseId = (await job.getSubmissionResponses(submissionId))[0];

    const revealEnd = Number(await job.getRevealPhaseEnd(0));
    await time.increaseTo(revealEnd + 1);
    await job.connect(client).finalizeWinners(0, [agentA.address], [ethers.parseUnits("120", 6)]);

    const economy = await job.getTaskEconomy(0);
    // Sole responder settles for the entire pool.
    const share = economy.interactionPool;
    const fee = (share * 1000n) / 10000n;
    const payout = share - fee;
    const responderBefore = await usdc.balanceOf(agentB.address);
    const treasuryBefore = await usdc.balanceOf(treasury.address);

    await expect(job.connect(agentB).settleRevealPhase(0)).to.emit(job, "RevealPhaseSettled");

    const responderAfter = await usdc.balanceOf(agentB.address);
    const treasuryAfter = await usdc.balanceOf(treasury.address);
    const response = await job.getResponse(responseId);

    expect(responderAfter - responderBefore).to.equal(payout + response.stakedAmount);
    expect(treasuryAfter - treasuryBefore).to.equal(fee);
    expect(response.stakeReturned).to.equal(true);
    expect(response.interactionRewardClaimed).to.equal(true);
    expect(await job.unclaimedResponseCount(0)).to.equal(0);
    expect(await job.getInteractionPoolRemaining(0)).to.equal(0);
  });

  it("unlimited responders split the pool equally at settlement", async function () {
    const { job, client, agentA, agentB, agentC, treasury, usdc, others } = await deployFixture();
    await createJobWithEconomy(job, client, {
      reward: "100",
      maxApprovals: 2,
      interactionStake: ethers.parseUnits("0.5", 6),
      interactionPoolPercent: 1000
    });

    const submissionA = await submit(job, agentA, "https://example.com/a");
    const submissionB = await submit(job, agentB, "https://example.com/b");
    await enterReveal(job, client, [agentA.address, agentB.address]);

    // 21 distinct responders - well past the old 20-slot cap. Each wallet
    // interacts exactly once and every response joins the split.
    const responders = [agentC, ...others.slice(0, 20)];
    expect(responders.length).to.equal(21);

    for (let i = 0; i < responders.length; i += 1) {
      const target = i % 2 === 0 ? submissionA : submissionB;
      await job.connect(responders[i]).respondToSubmission(target, 1, `ipfs://critique-${i}`);
    }

    const pool = ethers.parseUnits("10", 6);
    expect(await job.unclaimedResponseCount(0)).to.equal(21);
    // Rewards only leave the pot at settlement; the pool backs all 21 shares.
    expect(await job.getInteractionPoolRemaining(0)).to.equal(pool);

    const revealEnd = Number(await job.getRevealPhaseEnd(0));
    await time.increaseTo(revealEnd + 1);
    await job.connect(client).finalizeWinners(0, [agentA.address], [ethers.parseUnits("60", 6)]);

    const responseIds: bigint[] = [];
    for (const sid of [submissionA, submissionB]) {
      responseIds.push(...((await job.getSubmissionResponses(sid)) as bigint[]));
    }
    expect(responseIds.length).to.equal(21);

    const treasuryBefore = await usdc.balanceOf(treasury.address);
    let paidToResponders = 0n;
    for (const responseId of responseIds) {
      const response = await job.getResponse(responseId);
      const signer = responders.find((candidate) => candidate.address === response.responder)!;
      const before = await usdc.balanceOf(signer.address);
      await job.connect(signer).claimInteractionReward(responseId);
      const after = await usdc.balanceOf(signer.address);
      // Exclude the returned stake: only reward + fee belong to the pool.
      paidToResponders += after - before - response.stakedAmount;
    }

    const treasuryFees = (await usdc.balanceOf(treasury.address)) - treasuryBefore;
    expect(await job.unclaimedResponseCount(0)).to.equal(0);
    expect(await job.getInteractionPoolRemaining(0)).to.equal(0);
    // Floor rounding per claim; the pool pays out exactly.
    expect(paidToResponders + treasuryFees).to.equal(pool);
  });

  it("slashing releases the responder's share to the remaining responders", async function () {
    const { job, client, agentA, agentB, agentC, treasury, usdc } = await deployFixture();
    await createJobWithEconomy(job, client, { reward: "200", interactionPoolPercent: 1000 });
    const submissionId = await submit(job, agentA, "https://example.com/a");
    await enterReveal(job, client, [agentA.address]);

    await job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://from-b");
    await job.connect(agentC).respondToSubmission(submissionId, 0, "ipfs://from-c");
    expect(await job.unclaimedResponseCount(0)).to.equal(2);

    const responseIds = await job.getSubmissionResponses(submissionId);
    await job.connect(client).slashResponseStake(responseIds[1]);
    // C's slash releases their share: B is now the sole claimant of the pool.
    expect(await job.unclaimedResponseCount(0)).to.equal(1);

    const revealEnd = Number(await job.getRevealPhaseEnd(0));
    await time.increaseTo(revealEnd + 1);
    await job.connect(client).finalizeWinners(0, [agentA.address], [ethers.parseUnits("120", 6)]);

    const pool = ethers.parseUnits("20", 6);
    const treasuryBefore = await usdc.balanceOf(treasury.address);
    const bBefore = await usdc.balanceOf(agentB.address);
    await job.connect(agentB).claimInteractionReward(responseIds[0]);
    const bAfter = await usdc.balanceOf(agentB.address);
    const treasuryAfter = await usdc.balanceOf(treasury.address);

    const fee = (pool * 1000n) / 10000n;
    expect(bAfter - bBefore).to.equal(pool - fee + ethers.parseUnits("2", 6));
    expect(treasuryAfter - treasuryBefore).to.equal(fee);
    expect(await job.unclaimedResponseCount(0)).to.equal(0);
    expect(await job.getInteractionPoolRemaining(0)).to.equal(0);
  });

  it("submitDirect combines accept and submit in one tx", async function () {
    const { job, client, agentA } = await deployFixture();
    await createClassicJob(job, client);

    await expect(job.connect(agentA).submitDirect(0, "https://example.com/direct"))
      .to.emit(job, "DeliverableSubmitted");

    expect(await job.isAccepted(0, agentA.address)).to.equal(true);
    const submission = await job.getSubmission(0, agentA.address);
    expect(submission.status).to.equal(1);
  });

  it("autoStartReveal triggers when submissions <= maxApprovals+5", async function () {
    const { job, client, agentA, agentB, agentC } = await deployFixture();
    const deadline = await createClassicJob(job, client, "120", 2);

    await submit(job, agentA, "https://example.com/a");
    await submit(job, agentB, "https://example.com/b");

    await time.increaseTo(deadline + 1);

    await expect(job.connect(agentC).autoStartReveal(0)).to.emit(job, "AutoRevealStarted");
    expect(await job.isInRevealPhase(0)).to.equal(true);
  });

  it("autoStartReveal reverts if too many submissions", async function () {
    const { job, client, others } = await deployFixture();
    const deadline = await createClassicJob(job, client, "300", 3);
    const participants = others.slice(0, 9);

    for (const signer of participants) {
      await submit(job, signer, `https://example.com/${signer.address}`);
    }

    await time.increaseTo(deadline + 1);
    await expect(job.connect(participants[0]).autoStartReveal(0)).to.be.reverted;
  });

  it("selectFinalists starts reveal phase", async function () {
    const { job, client, agentA } = await deployFixture();
    await createClassicJob(job, client);
    await submit(job, agentA, "https://example.com/a");

    await acceptAndPromote(job, client, 0, [agentA.address]);
    await expect(job.connect(client).selectFinalists(0, [agentA.address])).to.emit(job, "FinalistsSelected");
    expect(await job.isInRevealPhase(0)).to.equal(true);
  });

  it("finalizeWinners reverts before reveal ends", async function () {
    const { job, client, agentA } = await deployFixture();
    await createClassicJob(job, client);
    await submit(job, agentA, "https://example.com/a");
    await enterReveal(job, client, [agentA.address]);

    await expect(
      job.connect(client).finalizeWinners(0, [agentA.address], [ethers.parseUnits("50", 6)])
    ).to.be.reverted;
  });

  it("finalizeWinners only accepts finalists", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createClassicJob(job, client);
    await submit(job, agentA, "https://example.com/a");
    await submit(job, agentB, "https://example.com/b");
    await enterReveal(job, client, [agentA.address]);

    const revealEnd = Number(await job.getRevealPhaseEnd(0));
    await time.increaseTo(revealEnd + 1);

    await expect(
      job.connect(client).finalizeWinners(0, [agentB.address], [ethers.parseUnits("40", 6)])
    ).to.be.reverted;
  });
});
