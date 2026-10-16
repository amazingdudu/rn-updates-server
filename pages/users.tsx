import { UserAddOutlined } from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import Head from 'next/head';
import { useEffect, useState } from 'react';

import AdminShell from '../components/AdminShell';

type User = { id: number; username: string; role: string; createdAt: string };

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();

  async function load() {
    setLoading(true);
    try {
      const response = await fetch('/api/users');
      if (response.status === 401 || response.status === 403) {
        window.location.href = '/';
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '读取用户失败');
      setUsers(body);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取用户失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const auth = await fetch('/api/auth/me');
      if (!auth.ok) {
        window.location.href = '/login';
        return;
      }
      const body = await auth.json();
      setUsername(body.user.username);
      if (body.user.role !== 'admin') {
        window.location.href = '/';
        return;
      }
      await load();
    })();
  }, []);

  async function createUser(values: { username: string; password: string; role: string }) {
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
    const body = await response.json();
    if (!response.ok) {
      message.error(body.error ?? '创建用户失败');
      return;
    }
    message.success(`已创建用户 ${body.username}`);
    form.resetFields();
    await load();
  }

  const columns: TableProps<User>['columns'] = [
    { title: '用户名', dataIndex: 'username' },
    {
      title: '角色',
      dataIndex: 'role',
      render: (role: string) => (
        <Tag color={role === 'admin' ? 'blue' : 'default'}>
          {role === 'admin' ? '管理员' : '发布者'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
  ];

  return (
    <AdminShell username={username} role="admin">
      <Head>
        <title>用户管理 · Expo Updates</title>
      </Head>
      <Space direction="vertical" size="large" className="page-stack">
        <div className="page-heading">
          <div>
            <Typography.Title level={2}>用户管理</Typography.Title>
            <Typography.Paragraph type="secondary">
              CLI 和后台均使用管理员创建的账户登录。
            </Typography.Paragraph>
          </div>
        </div>
        {error && <Alert type="error" showIcon message={error} />}
        <Card title="新建用户" extra={<UserAddOutlined />}>
          <Form
            form={form}
            layout="vertical"
            onFinish={(values) => void createUser(values)}
            className="user-create-form"
          >
            <Form.Item
              name="username"
              label="用户名"
              rules={[
                { required: true },
                { min: 3, max: 64 },
                { pattern: /^[A-Za-z0-9_.-]+$/, message: '仅支持字母、数字、点、下划线和连字符' },
              ]}
            >
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="password"
              label="初始密码"
              extra="至少 12 个字符。请通过安全渠道告知用户。"
              rules={[{ required: true }, { min: 12 }]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="role" label="角色" initialValue="publisher">
              <Select
                options={[
                  { value: 'publisher', label: '发布者' },
                  { value: 'admin', label: '管理员' },
                ]}
              />
            </Form.Item>
            <Form.Item className="user-submit">
              <Button type="primary" htmlType="submit">
                创建用户
              </Button>
            </Form.Item>
          </Form>
        </Card>
        <Card title="现有用户">
          <Table
            rowKey="id"
            columns={columns}
            dataSource={users}
            loading={loading}
            pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 位用户` }}
          />
        </Card>
      </Space>
    </AdminShell>
  );
}
