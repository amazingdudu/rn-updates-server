import { AppstoreOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { App as AntApp, Avatar, Button, Layout, Menu, Space, Typography } from 'antd';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';

const { Header, Content, Sider } = Layout;

export default function AdminShell({
  children,
  username,
  role,
}: {
  children: ReactNode;
  username?: string;
  role?: string;
}) {
  const router = useRouter();
  const { message } = AntApp.useApp();
  const selectedKey = router.pathname.startsWith('/users') ? '/users' : '/';

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    await router.replace('/login');
  }

  return (
    <Layout className="admin-layout">
      <Sider breakpoint="lg" collapsedWidth={0} theme="light" className="admin-sider">
        <div className="brand-mark">
          <AppstoreOutlined /> Expo Updates
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={[
            {
              key: '/',
              icon: <AppstoreOutlined />,
              label: '应用管理',
              onClick: () => void router.push('/'),
            },
            ...(role === 'admin'
              ? [
                  {
                    key: '/users',
                    icon: <UserOutlined />,
                    label: '用户管理',
                    onClick: () => void router.push('/users'),
                  },
                ]
              : []),
          ]}
        />
      </Sider>
      <Layout>
        <Header className="admin-header">
          <Typography.Text type="secondary">热更新管理控制台</Typography.Text>
          <Space>
            <Avatar size="small" icon={<UserOutlined />} />
            <Typography.Text>{username ?? '账户'}</Typography.Text>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={() => void logout().catch(() => message.error('退出失败'))}
            >
              退出
            </Button>
          </Space>
        </Header>
        <Content className="admin-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
