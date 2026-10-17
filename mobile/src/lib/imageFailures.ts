/**
 * Image URLs that already failed to load (404 / not uploaded yet). Module-level so recycled
 * list cells and other screens don't request the same missing image again this session.
 */
const failed = new Set<string>();

export const hasImageFailed = (url: string | null | undefined) => !!url && failed.has(url);
export const markImageFailed = (url: string) => void failed.add(url);
