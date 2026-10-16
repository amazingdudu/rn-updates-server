import { RocketOutlined } from '@ant-design/icons';
import { Alert, App as AntApp, Button, Card, Form, Input, Space, Typography } from 'antd';
import Head from 'next/head';
import { useState } from 'react';

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { message } = AntApp.useApp();

  async function submit(values: { username: string; password: string }) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '登录失败');
      window.location.href = '/';
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : '登录失败';
      setError(text);
      message.error(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <Head>
        <title>登录 · Expo Updates</title>
      </Head>
      <Card className="login-card">
        <Space direction="vertical" size="large" className="full-width">
          <div>
            <RocketOutlined className="login-icon" />
            <Typography.Title level={2}>登录后台</Typography.Title>
            <Typography.Paragraph type="secondary">
              账号由管理员创建，不开放自助注册。
            </Typography.Paragraph>
          </div>
          {error && <Alert type="error" showIcon message={error} />}
          <Form layout="vertical" onFinish={(values) => void submit(values)}>
            <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
              <Input autoComplete="username" size="large" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true }]}>
              <Input.Password autoComplete="current-password" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={busy}>
              登录
            </Button>
          </Form>
        </Space>
      </Card>
    </main>
  );
}
