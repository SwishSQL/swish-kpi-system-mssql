'use client';

import { useEffect, useState } from 'react';

/** Tracks a media query, starting false so server and first client render agree. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
