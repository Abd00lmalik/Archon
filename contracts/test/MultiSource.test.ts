import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("MultiSource Integration", function () {
  async function deployFixture() {
    const [owner, client, agent, verifier, poster, treasury] = await ethers.getSigners();

    const sourceRegistry = await (await ethers.getContractFactory("SourceRegistry")).connect(owner).deploy();
    await sourceRegistry.waitForDeployment();

    const registry = await (await ethers.getContractFactory("ERC8004ValidationRegistry")).connect(owner).deploy();
    await registry.waitForDeployment();

    const hook = await (await ethers.getContractFactory("CredentialHook")).connect(owner).deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const usdc = await (await ethers.getContractFactory("MockUSDC")).connect(owner).deploy();
    await usdc.waitForDeployment();

    const seed = ethers.parseUnits("1000000", 6);
    await usdc.connect(owner).mint(client.address, seed);
    await usdc.connect(owner).mint(agent.address, seed);
    await usdc.connect(owner).mint(poster.address, seed);

    const job = await (await ethers.getContractFactory("ERC8183Job"))
      .connect(owner)
      .deploy(await hook.getAddress(), await usdc.getAddress(), await sourceRegistry.getAddress(), treasury.address, 1000);
    await job.waitForDeployment();

    const github = await (await ethers.getContractFactory("GitHubSource"))
      .connect(owner)
      .deploy(await hook.getAddress(), await sourceRegistry.getAddress());
    await github.waitForDeployment();

    const community = await (await ethers.getContractFactory("CommunitySource"))
      .connect(owner)
      .deploy(await hook.getAddress(), await sourceRegistry.getAddress());
    await community.waitForDeployment();

    const agentTasks = await (await ethers.getContractFactory("AgentTaskSource"))
      .connect(owner)
      .deploy(
        await hook.getAddress(),
        await usdc.getAddress(),
        await sourceRegistry.getAddress(),
        treasury.address,
        1000
      );
    await agentTasks.waitForDeployment();

    const peer = await (await ethers.getContractFactory("PeerAttestationSource"))
      .connect(owner)
      .deploy(await hook.getAddress(), await registry.getAddress());
    await peer.waitForDeployment();

    const governance = await (await ethers.getContractFactory("DAOGovernanceSource"))
      .connect(owner)
      .deploy(await hook.getAddress());
    await governance.waitForDeployment();

    const governor = await (await ethers.getContractFactory("MockGovernor")).connect(owner).deploy();
    await governor.waitForDeployment();

    await hook.connect(owner).registerSourceContract(await job.getAddress(), true);
    await hook.connect(owner).registerSourceContract(await github.getAddress(), true);
    await hook.connect(owner).registerSourceContract(await community.getAddress(), true);
    await hook.connect(owner).registerSourceContract(await agentTasks.getAddress(), true);
    await hook.connect(owner).registerSourceContract(await peer.getAddress(), true);
    await hook.connect(owner).registerSourceContract(await governance.getAddress(), true);

    await sourceRegistry.connect(owner).approveOperator("job", client.address);
    await sourceRegistry.connect(owner).approveOperator("github", verifier.address);
    await sourceRegistry.connect(owner).approveOperator("community", verifier.address);
    await sourceRegistry.connect(owner).approveOperator("agent_task", poster.address);
    await sourceRegistry.connect(owner).approveOperator("agent_task", verifier.address);
    await community
      .connect(owner)
      .registerModerator(verifier.address, "ARC Community Team", "Discord Moderator", "https://x.com/abd00lmalik");

    await usdc.connect(client).approve(await job.getAddress(), seed);
    await usdc.connect(poster).approve(await agentTasks.getAddress(), seed);

    await governance.connect(owner).addGovernor(await governor.getAddress());

    return {
      owner,
      client,
      agent,
      verifier,
      poster,
      registry,
      usdc,
      job,
      github,
      community,
      agentTasks,
      peer,
      governance,
      governor
    };
  }

  it("lets one wallet earn credentials from all source types with correct weights", async function () {
    const {
      owner,
      client,
      agent,
      verifier,
      poster,
      registry,
      job,
      github,
      community,
      agentTasks,
      peer,
      governance,
      governor
    } = await deployFixture();

    // Source 1: Job
    const jobDeadline = (await time.latest()) + 3 * 60 * 60;
    await job
      .connect(client)
      .createJob("Landing", "Build page", jobDeadline, ethers.parseUnits("300", 6), 3);
    await job.connect(agent).acceptJob(0);
    await job.connect(agent).submitDeliverable(0, "https://github.com/org/repo/pull/1");
    await time.increase(61 * 60);
    await job.connect(client).approveSubmission(0, agent.address, ethers.parseUnits("100", 6));
    await job.connect(agent).claimCredential(0);

    // Source 2: GitHub
    await github.connect(agent).submitActivity(0, "https://github.com/org/repo/pull/2", "org/repo");
    await github.connect(verifier).approveActivity(0);
    await github.connect(agent).claimCredential(0);

    // Source 3: Community
    await community.connect(verifier).awardActivity(agent.address, 3, "discord", "Hosted community workshop");
    await community.connect(agent).claimCredential(0);

    // Source 4: Agent tasks
    const taskDeadline = (await time.latest()) + 3 * 60 * 60;
    await agentTasks.connect(poster).postTask("Evaluate outputs", "ipfs://task-input", taskDeadline, ethers.parseUnits("90", 6));
    await agentTasks.connect(agent).claimTask(0);
    await agentTasks.connect(agent).submitOutput(0, "ipfs://task-output");
    await time.increase(16 * 60);
    await agentTasks.connect(verifier).validateOutput(0, true, "valid");
    await agentTasks.connect(agent).claimRewardAndCredential(0);

    // Source 5: Peer attestation (attester must already have a credential).
    await registry.connect(owner).issue(verifier.address, 4000, "job", 1000);
    await peer
      .connect(verifier)
      .attest(
        agent.address,
        "technical",
        "Worked directly with this contributor on production fixes and reviewed their output quality."
      );

    // Source 6: DAO governance
    await governor.setVoted(42, agent.address, true);
    await governance.connect(agent).claimGovernanceCredential(await governor.getAddress(), 42);

    const credentialIds = await registry.getCredentials(agent.address);
    expect(credentialIds.length).to.equal(6);

    const sourceTypes: string[] = [];
    let totalWeight = 0n;
    for (const id of credentialIds) {
      const credential = await registry.getCredential(id);
      sourceTypes.push(credential.sourceType);
      totalWeight += credential.weight;
    }

    expect(sourceTypes).to.include.members([
      "job",
      "github",
      "community",
      "agent_task",
      "peer_attestation",
      "dao_governance"
    ]);
    expect(totalWeight).to.equal(710n);
  });

  it("enforces credential uniqueness per source and activity", async function () {
    const { agent, verifier, github } = await deployFixture();
    await github.connect(agent).submitActivity(0, "https://github.com/org/repo/pull/8", "org/repo");
    await github.connect(verifier).approveActivity(0);
    await github.connect(agent).claimCredential(0);
    await expect(github.connect(agent).claimCredential(0)).to.be.revertedWith("credential already claimed");
  });
});
