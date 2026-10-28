import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Evenly',
    short_name: 'Evenly',
    description: 'Snap the bill, say who had what, and see what everyone’s share is.',
    id: '/',
    start_url: '/groups',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff', // the splash screen, behind the white logo
    theme_color: '#36454d', // the slate counter, for the status bar
    categories: ['finance', 'food', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
