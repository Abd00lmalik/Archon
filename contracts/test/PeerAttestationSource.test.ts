import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("PeerAttestationSource", function () {
  async function deployFixture() {
    const [owner, attester, recipient, altRecipient] = await ethers.getSigners();

    const registry = await (await ethers.getContractFactory("ERC8004ValidationRegistry")).connect(owner).deploy();
    await registry.waitForDeployment();

    const hook = await (await ethers.getContractFactory("CredentialHook")).connect(owner).deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const peer = await (await ethers.getContractFactory("PeerAttestationSource"))
      .connect(owner)
      .deploy(await hook.getAddress(), await registry.getAddress());
    await peer.waitForDeployment();
    await hook.connect(owner).registerSourceContract(await peer.getAddress(), true);

    return { owner, attester, recipient, altRecipient, registry, hook, peer };
  }

  it("issues peer attestations and auto-mints recipient credentials", async function () {
    const { owner, attester, recipient, registry, peer } = await deployFixture();

    // Bootstrap attester with one credential.
    await registry.connect(owner).issue(attester.address, 999, "job", 100);

    await expect(peer.connect(attester).attest(recipient.address, "technical", "Great architecture review"))
      .to.emit(peer, "AttestationIssued")
      .withArgs(0, attester.address, recipient.address, "technical", 2, 60);

    const minted = await registry.getCredential(2);
    expect(minted.agent).to.equal(recipient.address);
    expect(minted.sourceType).to.equal("peer_attestation");
    expect(minted.weight).to.equal(60);
  });

  it("blocks self-attestation and requires attester credentials", async function () {
    const { attester, recipient, peer } = await deployFixture();

    await expect(peer.connect(attester).attest(attester.address, "technical", "self")).to.be.revertedWith(
      "cannot attest self"
    );
    await expect(peer.connect(attester).attest(recipient.address, "technical", "note")).to.be.revertedWith(
      "attester needs credential"
    );
  });

  it("enforces weekly anti-spam caps for attesters and recipients", async function () {
    const { owner, attester, recipient, altRecipient, registry, peer } = await deployFixture();
    await registry.connect(owner).issue(attester.address, 1, "job", 100);

    await peer.connect(attester).attest(recipient.address, "community", "First");
    await peer.connect(attester).attest(recipient.address, "community", "Second");
    await expect(peer.connect(attester).attest(recipient.address, "community", "Third")).to.be.revertedWith(
      "recipient weekly cap reached"
    );

    await peer.connect(attester).attest(altRecipient.address, "technical", "Third recipient");
    await expect(peer.connect(attester).attest(owner.address, "technical", "Fourth")).to.be.revertedWith(
      "weekly attestation cap"
    );

    await time.increase(7 * 24 * 60 * 60 + 1);
    await peer.connect(attester).attest(owner.address, "technical", "After reset");
  });
});
