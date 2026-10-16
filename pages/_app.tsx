import { App as AntApp, ConfigProvider } from 'antd';
import type { AppProps } from 'next/app';
import 'antd/dist/reset.css';
import '../styles/globals.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#2563eb',
          borderRadius: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
      }}
    >
      <AntApp>
        <Component {...pageProps} />
      </AntApp>
    </ConfigProvider>
  );
}
