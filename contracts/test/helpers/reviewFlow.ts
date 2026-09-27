/**
 * Test helper: walks the judge triage flow (accept verdict -> promote) so a
 * test can immediately call selectFinalists with the promoted set.
 */
export async function acceptAndPromote(
  job: any,
  reviewer: any,
  jobId: number | bigint,
  agents: string[]
) {
  for (const agent of agents) {
    const submission = await job.getSubmission(jobId, agent);
    const submissionId = Number(submission.submissionId);
    await job.connect(reviewer).setReviewVerdict(jobId, submissionId, 1);
    await job.connect(reviewer).setPromoted(jobId, agent, true);
  }
}
