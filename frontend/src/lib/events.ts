import { ethers } from "ethers";
import {
  getDeploymentConfig,
  parseCredential,
  parseJob
} from "@/lib/contracts";

type JobListener = (job: ReturnType<typeof parseJob>) => void;
type JobStatusListener = (status: number) => void;
type CredentialListener = (credential: ReturnType<typeof parseCredential>) => void;
type TaskListener = (taskId: number) => void;

function getContract(contractKey: keyof ReturnType<typeof getDeploymentConfig>["contracts"], provider: ethers.Provider) {
  const deployment = getDeploymentConfig();
  const config = deployment.contracts[contractKey];
  if (!config || config.address === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  return new ethers.Contract(config.address, config.abi as ethers.InterfaceAbi, provider);
}

export function subscribeToNewJobs(provider: ethers.Provider | null, onJob: JobListener): () => void {
  if (!provider) return () => undefined;
  const contract = getContract("job", provider);
  if (!contract) return () => undefined;

  const handler = async (jobId: bigint) => {
    try {
      const rawJob = await contract.getJob(jobId);
      onJob(parseJob(rawJob));
    } catch {
      // Ignore transient listener fetch errors.
    }
  };

  contract.on("JobCreated", handler);
  return () => contract.off("JobCreated", handler);
}

export function subscribeToJobUpdates(
  provider: ethers.Provider | null,
  jobId: number,
  onUpdate: JobStatusListener
): () => void {
  if (!provider) return () => undefined;
  const contract = getContract("job", provider);
  if (!contract) return () => undefined;

  const accepted = (eventJobId: bigint) => {
    if (Number(eventJobId) === jobId) onUpdate(1);
  };
  const submitted = (eventJobId: bigint) => {
    if (Number(eventJobId) === jobId) onUpdate(2);
  };
  const approved = (eventJobId: bigint) => {
    if (Number(eventJobId) === jobId) onUpdate(3);
  };
  const rejected = (eventJobId: bigint) => {
    if (Number(eventJobId) === jobId) onUpdate(4);
  };

  contract.on("JobAccepted", accepted);
  contract.on("DeliverableSubmitted", submitted);
  contract.on("SubmissionApproved", approved);
  contract.on("SubmissionRejected", rejected);

  return () => {
    contract.off("JobAccepted", accepted);
    contract.off("DeliverableSubmitted", submitted);
    contract.off("SubmissionApproved", approved);
    contract.off("SubmissionRejected", rejected);
  };
}

export function subscribeToCredentials(
  provider: ethers.Provider | null,
  agentAddress: string,
  onCredential: CredentialListener
): () => void {
  if (!provider || !agentAddress) return () => undefined;
  const contract = getContract("validationRegistry", provider);
  if (!contract) return () => undefined;
  const normalized = agentAddress.toLowerCase();

  const handler = async (
    eventAgent: string,
    activityId: bigint,
    credentialRecordId: bigint,
    issuedAt: bigint,
    sourceType: string,
    weight: bigint,
    issuedBy: string
  ) => {
    if (eventAgent.toLowerCase() !== normalized) return;
    onCredential(
      parseCredential({
        credentialId: credentialRecordId,
        agent: eventAgent,
        jobId: activityId,
        issuedAt,
        issuedBy,
        valid: true,
        sourceType,
        weight
      })
    );
  };

  contract.on("CredentialIssued", handler);
  return () => contract.off("CredentialIssued", handler);
}

export function subscribeToOpenTasks(
  provider: ethers.Provider | null,
  onTaskPosted: TaskListener
): () => void {
  if (!provider) return () => undefined;
  const deployment = getDeploymentConfig();
  if (
    !deployment.contracts.agentTaskSource ||
    deployment.contracts.agentTaskSource.address === "0x0000000000000000000000000000000000000000"
  ) {
    return () => undefined;
  }
  const contract = getContract("agentTaskSource", provider);
  if (!contract) return () => undefined;

  const handler = (taskId: bigint) => {
    onTaskPosted(Number(taskId));
  };

  contract.on("AgentTaskPosted", handler);
  return () => contract.off("AgentTaskPosted", handler);
}
