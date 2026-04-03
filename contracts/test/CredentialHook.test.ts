import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("CredentialHook", function () {
  async function deployFixture() {
    const [owner, client, agent, other] = await ethers.getSigners();

    const registryFactory = await ethers.getContractFactory("MockERC8004ValidationRegistry");
    const registry: any = await registryFactory.connect(owner).deploy();
    await registry.waitForDeployment();

    const hookFactory = await ethers.getContractFactory("CredentialHook");
    const hook: any = await hookFactory.connect(owner).deploy(await registry.getAddress());
    await hook.waitForDeployment();

    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const jobFactory = await ethers.getContractFactory("MockERC8183Job");
    const job: any = await jobFactory.connect(owner).deploy(await hook.getAddress());
    await job.waitForDeployment();

    await hook.connect(owner).registerJobContract(await job.getAddress(), true);

    return { owner, client, agent, other, registry, hook, job };
  }

  async function createSubmittedJob(job: any, client: any, agent: any) {
    await job.connect(client).createJob("Build MVP", "Ship credential flow");
    await job.connect(agent).acceptJob(0);
    await job.connect(agent).submitDeliverable(0, "ipfs://bafy-demo");
  }

  it("deploys all contracts with authorization wiring", async function () {
    const { owner, registry, hook, job } = await deployFixture();

    expect(await registry.authorizedIssuers(await hook.getAddress())).to.equal(true);
    expect(await hook.registeredJobContracts(await job.getAddress())).to.equal(true);
    expect(await hook.owner()).to.equal(owner.address);
  });

  it("creates a job and emits JobCreated", async function () {
    const { job, client } = await deployFixture();

    await expect(job.connect(client).createJob("Title", "Description"))
      .to.emit(job, "JobCreated")
      .withArgs(0, client.address, "Title", "Description");
  });

  it("accepts job and sets assigned agent with Accepted status", async function () {
    const { job, client, agent } = await deployFixture();

    await job.connect(client).createJob("Title", "Description");
    await job.connect(agent).acceptJob(0);

    const record = await job.getJob(0);
    expect(record.agent).to.equal(agent.address);
    expect(record.status).to.equal(1);
  });

  it("submits deliverable and updates status to Submitted", async function () {
    const { job, client, agent } = await deployFixture();

    await createSubmittedJob(job, client, agent);
    const record = await job.getJob(0);
    expect(record.deliverableHash).to.equal("ipfs://bafy-demo");
    expect(record.status).to.equal(2);
  });

  it("approves job and emits hook + registry events", async function () {
    const { job, registry, client, agent } = await deployFixture();

    await createSubmittedJob(job, client, agent);

    await expect(job.connect(client).approveJob(0))
      .to.emit(job, "JobApproved")
      .withArgs(0, client.address, agent.address, 1)
      .and.to.emit(registry, "CredentialIssued")
      .withArgs(agent.address, 0, 1, anyValue);
  });

  it("returns true for hasCredential after approval", async function () {
    const { job, registry, client, agent } = await deployFixture();

    await createSubmittedJob(job, client, agent);
    await job.connect(client).approveJob(0);

    expect(await registry.hasCredential(agent.address, 0)).to.equal(true);
  });

  it("reverts duplicate credential issuance", async function () {
    const { hook, registry, owner, agent } = await deployFixture();

    await hook.connect(owner).registerJobContract(owner.address, true);
    await hook.connect(owner).onJobComplete(agent.address, 100);

    await expect(hook.connect(owner).onJobComplete(agent.address, 100)).to.be.revertedWith(
      "credential already issued"
    );
    expect(await registry.totalCredentials()).to.equal(1);
  });

  it("prevents non-client from approving a job", async function () {
    const { job, client, agent, other } = await deployFixture();

    await createSubmittedJob(job, client, agent);
    await expect(job.connect(other).approveJob(0)).to.be.revertedWith("only client can approve");
  });

  it("prevents non-agent from submitting deliverable", async function () {
    const { job, client, agent, other } = await deployFixture();

    await job.connect(client).createJob("Title", "Description");
    await job.connect(agent).acceptJob(0);

    await expect(job.connect(other).submitDeliverable(0, "ipfs://x")).to.be.revertedWith(
      "only assigned agent can submit"
    );
  });

  it("reverts when unregistered caller hits hook", async function () {
    const { hook, other } = await deployFixture();

    await expect(hook.connect(other).onJobComplete(other.address, 1)).to.be.revertedWith(
      "job contract not registered"
    );
  });

  it("prevents client from accepting own job", async function () {
    const { job, client } = await deployFixture();

    await job.connect(client).createJob("Title", "Description");
    await expect(job.connect(client).acceptJob(0)).to.be.revertedWith("client cannot accept own job");
  });

  it("requires accepted job before deliverable submission", async function () {
    const { job, client, agent } = await deployFixture();

    await job.connect(client).createJob("Title", "Description");
    await expect(job.connect(agent).submitDeliverable(0, "ipfs://x")).to.be.revertedWith(
      "job is not accepted"
    );
  });
});
