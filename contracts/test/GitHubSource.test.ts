import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("GitHubSource", function () {
  async function deployFixture() {
    const [owner, agent, verifier, other] = await ethers.getSigners();

    const sourceRegistry = await (await ethers.getContractFactory("SourceRegistry")).connect(owner).deploy();
    await sourceRegistry.waitForDeployment();

    const registry = await (await ethers.getContractFactory("ERC8004ValidationRegistry")).connect(owner).deploy();
    await registry.waitForDeployment();

    const hook = await (await ethers.getContractFactory("CredentialHook")).connect(owner).deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const github = await (await ethers.getContractFactory("GitHubSource"))
      .connect(owner)
      .deploy(await hook.getAddress(), await sourceRegistry.getAddress());
    await github.waitForDeployment();
    await hook.connect(owner).registerSourceContract(await github.getAddress(), true);

    await sourceRegistry.connect(owner).approveOperator("github", verifier.address);

    return { owner, agent, verifier, other, sourceRegistry, registry, hook, github };
  }

  it("submits, approves, and claims a github credential", async function () {
    const { agent, verifier, registry, github } = await deployFixture();

    await github
      .connect(agent)
      .submitActivity(0, "https://github.com/org/repo/pull/1", "org/repo");
    await github.connect(verifier).approveActivity(0);

    await expect(github.connect(agent).claimCredential(0))
      .to.emit(github, "GitHubCredentialClaimed")
      .withArgs(0, agent.address, 1, 150);

    const credential = await registry.getCredential(1);
    expect(credential.sourceType).to.equal("github");
    expect(credential.weight).to.equal(150);
    expect(credential.agent).to.equal(agent.address);
  });

  it("blocks unauthorized verifiers", async function () {
    const { agent, other, github } = await deployFixture();
    await github
      .connect(agent)
      .submitActivity(1, "https://github.com/org/repo/issues/42", "org/repo");

    await expect(github.connect(other).approveActivity(0)).to.be.revertedWith("source operator not approved");
    await expect(github.connect(other).rejectActivity(0, "bad")).to.be.revertedWith("source operator not approved");
  });

  it("enforces pending claim anti-spam limits", async function () {
    const { agent, github } = await deployFixture();

    for (let i = 0; i < 5; i++) {
      await github
        .connect(agent)
        .submitActivity(2, `https://github.com/org/repo/pull/${i + 1}`, "org/repo");
    }

    await expect(
      github.connect(agent).submitActivity(2, "https://github.com/org/repo/pull/99", "org/repo")
    ).to.be.revertedWith("too many pending claims");
  });

  it("handles invalid input, rejection, and double-claim edge cases", async function () {
    const { agent, verifier, github } = await deployFixture();

    await expect(github.connect(agent).submitActivity(0, "https://example.com/pr/1", "org/repo")).to.be.revertedWith(
      "invalid github url"
    );

    await github
      .connect(agent)
      .submitActivity(3, "https://github.com/org/repo/pull/300", "org/repo");
    await github.connect(verifier).rejectActivity(0, "not enough signal");
    await expect(github.connect(agent).claimCredential(0)).to.be.revertedWith("activity not approved");

    await github
      .connect(agent)
      .submitActivity(4, "https://github.com/org/repo/pull/301", "org/repo");
    await github.connect(verifier).approveActivity(1);
    await github.connect(agent).claimCredential(1);

    await expect(github.connect(agent).claimCredential(1)).to.be.revertedWith("credential already claimed");

    // Cooldown active on new approved claim.
    await github
      .connect(agent)
      .submitActivity(1, "https://github.com/org/repo/issues/302", "org/repo");
    await github.connect(verifier).approveActivity(2);
    await expect(github.connect(agent).claimCredential(2)).to.be.revertedWith("credential cooldown active");

    await time.increase(6 * 60 * 60 + 1);
    await github.connect(agent).claimCredential(2);
  });
});
