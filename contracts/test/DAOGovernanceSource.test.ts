import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("DAOGovernanceSource", function () {
  async function deployFixture() {
    const [owner, participant, other] = await ethers.getSigners();

    const registry = await (await ethers.getContractFactory("ERC8004ValidationRegistry")).connect(owner).deploy();
    await registry.waitForDeployment();

    const hook = await (await ethers.getContractFactory("CredentialHook")).connect(owner).deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const governance = await (await ethers.getContractFactory("DAOGovernanceSource"))
      .connect(owner)
      .deploy(await hook.getAddress());
    await governance.waitForDeployment();
    await hook.connect(owner).registerSourceContract(await governance.getAddress(), true);

    const governor = await (await ethers.getContractFactory("MockGovernor")).connect(owner).deploy();
    await governor.waitForDeployment();

    return { owner, participant, other, registry, hook, governance, governor };
  }

  it("verifies on-chain vote and mints governance credential", async function () {
    const { owner, participant, registry, governance, governor } = await deployFixture();
    await governance.connect(owner).addGovernor(await governor.getAddress());
    await governor.setVoted(55, participant.address, true);
    await governor.setState(55, 7);

    await expect(governance.connect(participant).claimGovernanceCredential(await governor.getAddress(), 55))
      .to.emit(governance, "GovernanceCredentialClaimed")
      .withArgs(0, participant.address, await governor.getAddress(), 55, 1, 90);

    const credential = await registry.getCredential(1);
    expect(credential.sourceType).to.equal("dao_governance");
    expect(credential.weight).to.equal(90);
  });

  it("rejects unauthorized governor contracts and duplicate claims", async function () {
    const { owner, participant, governance, governor } = await deployFixture();
    await governor.setVoted(99, participant.address, true);

    await expect(
      governance.connect(participant).claimGovernanceCredential(await governor.getAddress(), 99)
    ).to.be.revertedWith("governor not approved");

    await governance.connect(owner).addGovernor(await governor.getAddress());
    await governance.connect(participant).claimGovernanceCredential(await governor.getAddress(), 99);
    await expect(
      governance.connect(participant).claimGovernanceCredential(await governor.getAddress(), 99)
    ).to.be.revertedWith("already claimed");
  });

  it("enforces credential cooldown and missing-vote edge cases", async function () {
    const { owner, participant, governance, governor } = await deployFixture();
    await governance.connect(owner).addGovernor(await governor.getAddress());
    await governor.setVoted(1, participant.address, true);
    await governor.setVoted(2, participant.address, true);

    await governance.connect(participant).claimGovernanceCredential(await governor.getAddress(), 1);
    await expect(
      governance.connect(participant).claimGovernanceCredential(await governor.getAddress(), 2)
    ).to.be.revertedWith("credential cooldown active");

    await time.increase(6 * 60 * 60 + 1);
    await governance.connect(participant).claimGovernanceCredential(await governor.getAddress(), 2);

    await expect(
      governance.connect(participant).claimGovernanceCredential(await governor.getAddress(), 200)
    ).to.be.revertedWith("vote not found");
  });
});
