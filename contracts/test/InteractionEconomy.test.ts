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
    expect(await job.hasResponded(submissionId, agentB.address)).to.equal(true);
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
    const fee = (economy.interactionReward * 1000n) / 10000n;
    const payout = economy.interactionReward - fee;

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
    const fee = (economy.interactionReward * 1000n) / 10000n;
    const payout = economy.interactionReward - fee;
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
  });

  it("claimInteractionReward respects pool cap", async function () {
    const { job, client, agentA, agentB, agentC, others } = await deployFixture();
    await createJobWithEconomy(job, client, {
      reward: "100",
      maxApprovals: 2,
      interactionStake: ethers.parseUnits("0.5", 6),
      interactionPoolPercent: 1000
    });

    const submissionA = await submit(job, agentA, "https://example.com/a");
    const submissionB = await submit(job, agentB, "https://example.com/b");
    await enterReveal(job, client, [agentA.address, agentB.address]);

    const responders = [agentC, ...others.slice(0, 10)];
    const responseIds: bigint[] = [];

    for (const responder of responders) {
      await job.connect(responder).respondToSubmission(submissionA, 1, `ipfs://critique-${responder.address}`);
      responseIds.push((await job.getSubmissionResponses(submissionA)).slice(-1)[0]);
    }

    for (const responder of responders.slice(0, 10)) {
      await job.connect(responder).respondToSubmission(submissionB, 0, `ipfs://build-${responder.address}`);
      responseIds.push((await job.getSubmissionResponses(submissionB)).slice(-1)[0]);
    }

    expect(responseIds.length).to.equal(21);

    const revealEnd = Number(await job.getRevealPhaseEnd(0));
    await time.increaseTo(revealEnd + 1);
    await job.connect(client).finalizeWinners(0, [agentA.address], [ethers.parseUnits("60", 6)]);

    for (const responseId of responseIds.slice(0, 20)) {
      const response = await job.getResponse(responseId);
      const responder = response.responder;
      const signer = [agentC, ...others].find((candidate) => candidate.address === responder);
      await job.connect(signer!).claimInteractionReward(responseId);
    }

    const lastResponse = await job.getResponse(responseIds[20]);
    const lastSigner = [agentC, ...others].find((candidate) => candidate.address === lastResponse.responder)!;
    await expect(job.connect(lastSigner).claimInteractionReward(responseIds[20])).to.be.reverted;
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
