import { useEffect, useMemo, useState } from 'react';

import {
  PAGE_SIZE,
  PAGINATION_MIN_ITEMS,
  slicePage,
  totalPagesFor,
} from '@/lib/pagination';

/**
 * Client-side page slicing. Resets to page 0 when `resetKey` changes
 * (e.g. search/filter string) or when the item count shrinks below the page.
 */
export function useClientPagination<T>(
  items: T[],
  resetKey: string | number = '',
  pageSize: number = PAGE_SIZE,
) {
  const [page, setPage] = useState(0);
  const total = items.length;
  const totalPages = totalPagesFor(total, pageSize);
  const showPagination = total >= Math.min(pageSize, PAGINATION_MIN_ITEMS);

  useEffect(() => {
    setPage(0);
  }, [resetKey]);

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const pageItems = useMemo(
    () => slicePage(items, Math.min(page, totalPages - 1), pageSize),
    [items, page, totalPages, pageSize],
  );

  return {
    page: Math.min(page, totalPages - 1),
    setPage,
    totalPages,
    pageItems,
    showPagination,
    total,
    pageSize,
  };
}
