import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("MilestoneEscrow", function () {
  async function deployFixture() {
    const [owner, client, freelancer, arb1, arb2, arb3, other] = await ethers.getSigners();

    const usdc = await (await ethers.getContractFactory("MockUSDC")).connect(owner).deploy();
    await usdc.waitForDeployment();

    const escrow = await (await ethers.getContractFactory("MilestoneEscrow"))
      .connect(owner)
      .deploy(await usdc.getAddress(), owner.address, 1000);
    await escrow.waitForDeployment();

    const million = ethers.parseUnits("1000000", 6);
    await usdc.connect(owner).mint(client.address, million);
    await usdc.connect(client).approve(await escrow.getAddress(), million);

    await escrow.connect(owner).addArbitrator(arb1.address);
    await escrow.connect(owner).addArbitrator(arb2.address);
    await escrow.connect(owner).addArbitrator(arb3.address);

    return { owner, client, freelancer, arb1, arb2, arb3, other, usdc, escrow };
  }

  async function createSingleMilestoneProject(escrow: any, client: any, freelancer: any) {
    const deadline = (await time.latest()) + 3 * 60 * 60;
    await escrow
      .connect(client)
      .proposeProject(
        freelancer.address,
        ["Milestone 1"],
        ["Build and ship module"],
        [ethers.parseUnits("100", 6)],
        [deadline]
      );
    return { milestoneId: 0, projectId: 0, deadline, amount: ethers.parseUnits("100", 6) };
  }

  function signerFor(address: string, signers: any[]) {
    return signers.find((signer) => signer.address.toLowerCase() === address.toLowerCase());
  }

  it("proposeProject creates milestones correctly", async function () {
    const { client, freelancer, escrow } = await deployFixture();
    await createSingleMilestoneProject(escrow, client, freelancer);

    const projectMilestones = await escrow.getMilestonesByProject(0);
    expect(projectMilestones.length).to.equal(1);
    expect(projectMilestones[0]).to.equal(0);

    const milestone = await escrow.getMilestone(0);
    expect(milestone.client).to.equal(client.address);
    expect(milestone.freelancer).to.equal(freelancer.address);
    expect(milestone.status).to.equal(0);
  });

  it("fundMilestone transfers USDC to contract", async function () {
    const { client, freelancer, escrow, usdc } = await deployFixture();
    const { milestoneId, amount } = await createSingleMilestoneProject(escrow, client, freelancer);

    const before = await usdc.balanceOf(await escrow.getAddress());
    await escrow.connect(client).fundMilestone(milestoneId);
    const after = await usdc.balanceOf(await escrow.getAddress());

    expect(after - before).to.equal(amount);
    expect(await escrow.totalEscrowed()).to.equal(amount);
  });

  it("submitDeliverable updates status and hash", async function () {
    const { client, freelancer, escrow } = await deployFixture();
    const { milestoneId } = await createSingleMilestoneProject(escrow, client, freelancer);
    await escrow.connect(client).fundMilestone(milestoneId);

    const hash = "ipfs://bafybeihash";
    await escrow.connect(freelancer).submitDeliverable(milestoneId, hash);

    const milestone = await escrow.getMilestone(milestoneId);
    expect(milestone.status).to.equal(1);
    expect(milestone.deliverableHash).to.equal(hash);
    expect(milestone.submittedAt).to.be.greaterThan(0);
  });

  it("approveMilestone releases correct USDC amount with fee", async function () {
    const { owner, client, freelancer, escrow, usdc } = await deployFixture();
    const { milestoneId, amount } = await createSingleMilestoneProject(escrow, client, freelancer);
    await escrow.connect(client).fundMilestone(milestoneId);
    await escrow.connect(freelancer).submitDeliverable(milestoneId, "https://example.com/work");

    const ownerBefore = await usdc.balanceOf(owner.address);
    const freelancerBefore = await usdc.balanceOf(freelancer.address);

    await escrow.connect(client).approveMilestone(milestoneId);

    const fee = (amount * 1000n) / 10000n;
    const payout = amount - fee;
    expect(await usdc.balanceOf(owner.address)).to.equal(ownerBefore + fee);
    expect(await usdc.balanceOf(freelancer.address)).to.equal(freelancerBefore + payout);
    expect(await escrow.totalEscrowed()).to.equal(0);
  });

  it("autoRelease works after DISPUTE_WINDOW elapsed", async function () {
    const { owner, client, freelancer, escrow, usdc } = await deployFixture();
    const { milestoneId, amount } = await createSingleMilestoneProject(escrow, client, freelancer);
    await escrow.connect(client).fundMilestone(milestoneId);
    await escrow.connect(freelancer).submitDeliverable(milestoneId, "https://example.com/work");

    await time.increase(48 * 60 * 60 + 5);

    const ownerBefore = await usdc.balanceOf(owner.address);
    const freelancerBefore = await usdc.balanceOf(freelancer.address);
    await escrow.connect(freelancer).autoRelease(milestoneId);

    const fee = (amount * 1000n) / 10000n;
    const payout = amount - fee;
    expect(await usdc.balanceOf(owner.address)).to.equal(ownerBefore + fee);
    expect(await usdc.balanceOf(freelancer.address)).to.equal(freelancerBefore + payout);
  });

  it("raiseDispute assigns 3 arbitrators", async function () {
    const { client, freelancer, escrow } = await deployFixture();
    const { milestoneId } = await createSingleMilestoneProject(escrow, client, freelancer);
    await escrow.connect(client).fundMilestone(milestoneId);
    await escrow.connect(freelancer).submitDeliverable(milestoneId, "https://example.com/work");

    await escrow.connect(client).raiseDispute(milestoneId, "The deliverable does not satisfy the acceptance criteria.");
    const dispute = await escrow.getDispute(milestoneId);

    expect(dispute.arbitrators[0]).to.not.equal(ethers.ZeroAddress);
    expect(dispute.arbitrators[1]).to.not.equal(ethers.ZeroAddress);
    expect(dispute.arbitrators[2]).to.not.equal(ethers.ZeroAddress);
    expect(dispute.arbitrators[0]).to.not.equal(dispute.arbitrators[1]);
    expect(dispute.arbitrators[0]).to.not.equal(dispute.arbitrators[2]);
    expect(dispute.arbitrators[1]).to.not.equal(dispute.arbitrators[2]);
  });

  it("voteOnDispute resolves with majority (2 of 3)", async function () {
    const { client, freelancer, escrow, arb1, arb2, arb3 } = await deployFixture();
    const { milestoneId } = await createSingleMilestoneProject(escrow, client, freelancer);
    await escrow.connect(client).fundMilestone(milestoneId);
    await escrow.connect(freelancer).submitDeliverable(milestoneId, "https://example.com/work");
    await escrow.connect(client).raiseDispute(milestoneId, "Review requested due mismatch with acceptance criteria.");

    const dispute = await escrow.getDispute(milestoneId);
    const signers = [arb1, arb2, arb3, client, freelancer];
    const first = signerFor(dispute.arbitrators[0], signers);
    const second = signerFor(dispute.arbitrators[1], signers);
    expect(first).to.not.equal(undefined);
    expect(second).to.not.equal(undefined);

    await escrow.connect(first).voteOnDispute(milestoneId, 1);
    await escrow.connect(second).voteOnDispute(milestoneId, 1);

    const after = await escrow.getDispute(milestoneId);
    expect(after.resolved).to.equal(true);
    expect(after.outcome).to.equal(1);
  });

  it("FavorFreelancer outcome releases funds to freelancer", async function () {
    const { owner, client, freelancer, escrow, usdc, arb1, arb2, arb3 } = await deployFixture();
    const { milestoneId, amount } = await createSingleMilestoneProject(escrow, client, freelancer);
    await escrow.connect(client).fundMilestone(milestoneId);
    await escrow.connect(freelancer).submitDeliverable(milestoneId, "https://example.com/work");
    await escrow.connect(client).raiseDispute(milestoneId, "Need arbitration due delivery disagreement.");

    const dispute = await escrow.getDispute(milestoneId);
    const signers = [arb1, arb2, arb3, client, freelancer];
    const first = signerFor(dispute.arbitrators[0], signers);
    const second = signerFor(dispute.arbitrators[1], signers);

    const ownerBefore = await usdc.balanceOf(owner.address);
    const freelancerBefore = await usdc.balanceOf(freelancer.address);

    await escrow.connect(first).voteOnDispute(milestoneId, 1);
    await escrow.connect(second).voteOnDispute(milestoneId, 1);

    const fee = (amount * 1000n) / 10000n;
    expect(await usdc.balanceOf(owner.address)).to.equal(ownerBefore + fee);
    expect(await usdc.balanceOf(freelancer.address)).to.equal(freelancerBefore + (amount - fee));
  });

  it("FavorClient outcome refunds client", async function () {
    const { client, freelancer, escrow, usdc, arb1, arb2, arb3 } = await deployFixture();
    const { milestoneId, amount } = await createSingleMilestoneProject(escrow, client, freelancer);
    await escrow.connect(client).fundMilestone(milestoneId);
    await escrow.connect(freelancer).submitDeliverable(milestoneId, "https://example.com/work");
    await escrow.connect(client).raiseDispute(milestoneId, "Refund requested because deliverable is incomplete.");

    const dispute = await escrow.getDispute(milestoneId);
    const signers = [arb1, arb2, arb3, client, freelancer];
    const first = signerFor(dispute.arbitrators[0], signers);
    const second = signerFor(dispute.arbitrators[1], signers);

    const clientBefore = await usdc.balanceOf(client.address);
    await escrow.connect(first).voteOnDispute(milestoneId, 2);
    await escrow.connect(second).voteOnDispute(milestoneId, 2);

    expect(await usdc.balanceOf(client.address)).to.equal(clientBefore + amount);
    const milestone = await escrow.getMilestone(milestoneId);
    expect(milestone.status).to.equal(5);
  });

  it("Cannot vote twice as same arbitrator", async function () {
    const { client, freelancer, escrow, arb1, arb2, arb3 } = await deployFixture();
    const { milestoneId } = await createSingleMilestoneProject(escrow, client, freelancer);
    await escrow.connect(client).fundMilestone(milestoneId);
    await escrow.connect(freelancer).submitDeliverable(milestoneId, "https://example.com/work");
    await escrow.connect(client).raiseDispute(milestoneId, "Escalating for arbitration due quality concerns.");

    const dispute = await escrow.getDispute(milestoneId);
    const signers = [arb1, arb2, arb3, client, freelancer];
    const first = signerFor(dispute.arbitrators[0], signers);
    expect(first).to.not.equal(undefined);

    await escrow.connect(first).voteOnDispute(milestoneId, 1);
    await expect(escrow.connect(first).voteOnDispute(milestoneId, 1)).to.be.revertedWith("already voted");
  });

  it("Cannot dispute after window elapsed", async function () {
    const { client, freelancer, escrow } = await deployFixture();
    const { milestoneId } = await createSingleMilestoneProject(escrow, client, freelancer);
    await escrow.connect(client).fundMilestone(milestoneId);
    await escrow.connect(freelancer).submitDeliverable(milestoneId, "https://example.com/work");

    await time.increase(48 * 60 * 60 + 2);
    await expect(
      escrow.connect(client).raiseDispute(milestoneId, "This should fail after dispute window.")
    ).to.be.revertedWith("dispute window elapsed");
  });

  it("Non-freelancer cannot submit deliverable", async function () {
    const { client, freelancer, other, escrow } = await deployFixture();
    const { milestoneId } = await createSingleMilestoneProject(escrow, client, freelancer);
    await escrow.connect(client).fundMilestone(milestoneId);

    await expect(
      escrow.connect(other).submitDeliverable(milestoneId, "https://example.com/work")
    ).to.be.revertedWith("only freelancer can submit");
  });
});
