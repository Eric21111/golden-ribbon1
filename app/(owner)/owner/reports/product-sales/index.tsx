import { SellingBranchesHubScreen } from '@/features/reports/SellingBranchesHubScreen';

export default function OwnerProductSalesBranches() {
  return (
    <SellingBranchesHubScreen
      title="Product Sales"
      hrefForBranch={(branchId) => `/owner/reports/product-sales/${branchId}`}
      accessibilityHint="Opens product sales for this branch"
    />
  );
}
