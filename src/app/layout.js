import './globals.css';
import AppShell from '../components/AppShell';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'LEKER — Sistema de Gestión de Inventarios',
  description: 'LEKER: Sistema web para gestión de inventarios con comparación de Excel, escáner de códigos de barras y reportes en tiempo real.',
  icons: {
    icon: '/logo.jpg',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
