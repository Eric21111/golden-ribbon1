-- Revision 7A — add waste/unsold movement types (committed before use).
alter type public.inventory_movement_type add value if not exists 'waste';
alter type public.inventory_movement_type add value if not exists 'unsold';
