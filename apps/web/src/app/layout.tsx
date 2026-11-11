import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Panel del negocio',
  description: 'Agenda, clientes y fidelización para salones, barberías y estudios de belleza.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#17202e' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
