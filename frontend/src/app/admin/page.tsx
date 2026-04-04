export default function AdminPage() {
  return (
    <section className="space-y-4">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Admin</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Source operator approvals and governance controls are managed on-chain via owner/admin wallets.
        </p>
      </div>
      <div className="archon-card p-6 text-sm text-[#9CA3AF]">
        Use contract admin methods for:
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>`SourceRegistry.approveOperator` / `revokeOperator`</li>
          <li>`CredentialHook.registerSourceContract`</li>
          <li>`DAOGovernanceSource.addGovernor`</li>
          <li>Platform treasury / fee updates on escrowed sources</li>
        </ul>
      </div>
    </section>
  );
}
