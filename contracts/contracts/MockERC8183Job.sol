// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICredentialHook {
    function onJobComplete(address agent, uint256 jobId) external returns (uint256);
}

contract MockERC8183Job {
    enum JobStatus {
        Open,
        Accepted,
        Submitted,
        Approved
    }

    struct Job {
        uint256 jobId;
        address client;
        address agent;
        string title;
        string description;
        string deliverableHash;
        JobStatus status;
    }

    uint256 public nextJobId;
    address public immutable hook;
    mapping(uint256 => Job) private jobs;

    event JobCreated(uint256 indexed jobId, address indexed client, string title, string description);
    event JobAccepted(uint256 indexed jobId, address indexed agent);
    event DeliverableSubmitted(uint256 indexed jobId, address indexed agent, string deliverableHash);
    event JobApproved(
        uint256 indexed jobId,
        address indexed client,
        address indexed agent,
        uint256 credentialRecordId
    );

    constructor(address hookAddress) {
        require(hookAddress != address(0), "invalid hook");
        hook = hookAddress;
    }

    function createJob(string calldata title, string calldata description) external returns (uint256 createdJobId) {
        createdJobId = nextJobId;
        nextJobId += 1;

        jobs[createdJobId] = Job({
            jobId: createdJobId,
            client: msg.sender,
            agent: address(0),
            title: title,
            description: description,
            deliverableHash: "",
            status: JobStatus.Open
        });

        emit JobCreated(createdJobId, msg.sender, title, description);
    }

    function acceptJob(uint256 jobId) external {
        Job storage job = _getExistingJob(jobId);
        require(job.status == JobStatus.Open, "job is not open");
        require(msg.sender != job.client, "client cannot accept own job");

        job.agent = msg.sender;
        job.status = JobStatus.Accepted;

        emit JobAccepted(jobId, msg.sender);
    }

    function submitDeliverable(uint256 jobId, string calldata deliverableHash) external {
        Job storage job = _getExistingJob(jobId);
        require(job.status == JobStatus.Accepted, "job is not accepted");
        require(msg.sender == job.agent, "only assigned agent can submit");
        require(bytes(deliverableHash).length > 0, "deliverable hash required");

        job.deliverableHash = deliverableHash;
        job.status = JobStatus.Submitted;

        emit DeliverableSubmitted(jobId, msg.sender, deliverableHash);
    }

    function approveJob(uint256 jobId) external {
        Job storage job = _getExistingJob(jobId);
        require(job.status == JobStatus.Submitted, "job is not submitted");
        require(msg.sender == job.client, "only client can approve");

        job.status = JobStatus.Approved;
        uint256 credentialRecordId = ICredentialHook(hook).onJobComplete(job.agent, jobId);

        emit JobApproved(jobId, msg.sender, job.agent, credentialRecordId);
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _getExistingJob(jobId);
    }

    function getAllJobs() external view returns (Job[] memory allJobs) {
        allJobs = new Job[](nextJobId);
        for (uint256 i = 0; i < nextJobId; i++) {
            allJobs[i] = jobs[i];
        }
    }

    function _getExistingJob(uint256 jobId) internal view returns (Job storage) {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job does not exist");
        return job;
    }
}
