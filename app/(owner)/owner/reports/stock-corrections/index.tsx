import { SellingBranchesHubScreen } from '@/features/reports/SellingBranchesHubScreen';

export default function OwnerVoidLogsBranches() {
  return (
    <SellingBranchesHubScreen
      title="Void logs"
      hrefForBranch={(branchId) => `/owner/reports/stock-corrections/${branchId}`}
      accessibilityHint="Opens void logs for this branch"
    />
  );
}
