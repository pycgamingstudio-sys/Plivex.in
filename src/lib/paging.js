export const PAGE_SIZE = 6;

export function paginate(list, page, size = PAGE_SIZE) {
  const start = (page - 1) * size;
  return list.slice(start, start + size);
}

export function totalPages(list, size = PAGE_SIZE) {
  return Math.max(1, Math.ceil(list.length / size));
}