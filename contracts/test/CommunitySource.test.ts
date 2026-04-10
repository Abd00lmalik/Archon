import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("CommunitySource", function () {
  async function deployFixture() {
    const [owner, moderator, recipient, other] = await ethers.getSigners();

    const sourceRegistry = await (await ethers.getContractFactory("SourceRegistry")).connect(owner).deploy();
    await sourceRegistry.waitForDeployment();

    const registry = await (await ethers.getContractFactory("ERC8004ValidationRegistry")).connect(owner).deploy();
    await registry.waitForDeployment();

    const hook = await (await ethers.getContractFactory("CredentialHook")).connect(owner).deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const community = await (await ethers.getContractFactory("CommunitySource"))
      .connect(owner)
      .deploy(await hook.getAddress(), await sourceRegistry.getAddress());
    await community.waitForDeployment();
    await hook.connect(owner).registerSourceContract(await community.getAddress(), true);

    await sourceRegistry.connect(owner).approveOperator("community", moderator.address);
    await community
      .connect(owner)
      .registerModerator(moderator.address, "ARC Community Team", "Technical Reviewer", "https://github.com/test");

    return { owner, moderator, recipient, other, sourceRegistry, registry, hook, community };
  }

  it("blocks unauthorized operators and self-awards", async function () {
    const { moderator, recipient, other, community } = await deployFixture();

    await expect(
      community.connect(other).awardActivity(recipient.address, 0, "github", "https://example.com/report")
    ).to.be.revertedWith("not an active moderator");

    await expect(
      community
        .connect(moderator)
        .awardActivity(moderator.address, 1, "github", "https://github.com/org/repo/pull/1")
    ).to.be.revertedWith("operator cannot self-award");
  });

  it("prevents double claims and enforces cooldown across activities", async function () {
    const { moderator, recipient, community } = await deployFixture();

    await community
      .connect(moderator)
      .awardActivity(recipient.address, 1, "github", "https://github.com/org/repo/pull/1");
    await community
      .connect(moderator)
      .awardActivity(recipient.address, 5, "blog", "https://mirror.xyz/archon-tech-tutorial");

    await community.connect(recipient).claimCredential(0);
    await expect(community.connect(recipient).claimCredential(0)).to.be.revertedWith("credential already claimed");
    await expect(community.connect(recipient).claimCredential(1)).to.be.revertedWith("credential cooldown active");

    await time.increase(6 * 60 * 60 + 1);
    await community.connect(recipient).claimCredential(1);
  });

  it("requires evidence link for submitted applications", async function () {
    const { recipient, community } = await deployFixture();
    const validDescription =
      "Built a full integration service that syncs protocol events, transforms data, and publishes verified metrics dashboard endpoints.";

    await expect(
      community
        .connect(recipient)
        .submitApplication(validDescription, "", "github")
    ).to.be.revertedWith(
      "evidence link required: provide GitHub PR, deployed contract, or live dApp URL"
    );
  });

  it("requires at least 100 chars for technical description", async function () {
    const { recipient, community } = await deployFixture();

    await expect(
      community
        .connect(recipient)
        .submitApplication("Too short technical description.", "https://github.com/org/repo/pull/1", "github")
    ).to.be.revertedWith("technical description must be at least 100 characters");
  });

  it("supports technical application submission and moderator approval flow", async function () {
    const { moderator, recipient, community } = await deployFixture();
    const description =
      "Built and deployed a complete dApp for on-chain milestone workflows, including wallet integration, escrow flows, and status dashboards with production docs.";

    await expect(
      community
        .connect(recipient)
        .submitApplication(
          description,
          "https://github.com/org/repo/pull/42",
          "github"
        )
    )
      .to.emit(community, "ApplicationSubmitted")
      .withArgs(0, recipient.address, "github");

    await expect(
      community.connect(moderator).approveApplication(0, 2, "Strong implementation and verifiable deployment evidence.")
    )
      .to.emit(community, "ApplicationApproved")
      .withArgs(0, moderator.address);

    const app = await community.getApplication(0);
    expect(app.status).to.equal(1);
    expect(app.reviewedBy).to.equal(moderator.address);
  });

  it("supports moderator rejection and blocks non-moderator review", async function () {
    const { moderator, recipient, other, community } = await deployFixture();
    const description =
      "Contributed protocol integration adapter with event indexing and endpoint delivery, but evidence link currently points to private repository unavailable to reviewers.";

    await community
      .connect(recipient)
      .submitApplication(description, "https://github.com/org/private/pull/99", "github");

    await expect(community.connect(other).approveApplication(0, 4, "looks good")).to.be.revertedWith(
      "not an active moderator"
    );

    await expect(
      community.connect(moderator).rejectApplication(0, "Evidence is private. Submit public reproducible links.")
    )
      .to.emit(community, "ApplicationRejected")
      .withArgs(0, moderator.address, "Evidence is private. Submit public reproducible links.");

    const app = await community.getApplication(0);
    expect(app.status).to.equal(2);
    expect(app.reviewedBy).to.equal(moderator.address);
  });

  it("each activity type mints the correct credential weight", async function () {
    const { moderator, recipient, registry, community } = await deployFixture();
    const expectedWeights = [100, 150, 200, 180, 130, 110, 160, 140];

    for (let i = 0; i < expectedWeights.length; i++) {
      await community
        .connect(moderator)
        .awardActivity(recipient.address, i, "github", `https://evidence.example/${i}`);
      await community.connect(recipient).claimCredential(i);

      const credential = await registry.getCredential(i + 1);
      expect(credential.sourceType).to.equal("community");
      expect(credential.weight).to.equal(expectedWeights[i]);

      if (i < expectedWeights.length - 1) {
        await time.increase(6 * 60 * 60 + 1);
      }
    }
  });
});
