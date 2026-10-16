import { PlusOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import AdminShell from '../components/AdminShell';

type Application = {
  id: number;
  slug: string;
  name: string;
  description: string;
  updateCount: number;
  pendingCount: number;
};
type User = { username: string; role: string };

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [user, setUser] = useState<User>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();

  async function load() {
    setLoading(true);
    try {
      const auth = await fetch('/api/auth/me');
      if (!auth.ok) {
        window.location.href = '/login';
        return;
      }
      const authBody = await auth.json();
      setUser(authBody.user);
      const response = await fetch('/api/apps');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '读取应用失败');
      setApps(body);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取应用失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createApp(values: { slug: string; name: string; description?: string }) {
    setCreating(true);
    try {
      const response = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...values, slug: values.slug.toLowerCase() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '创建应用失败');
      message.success('应用已创建');
      setOpen(false);
      form.resetFields();
      await load();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '创建应用失败');
    } finally {
      setCreating(false);
    }
  }

  return (
    <AdminShell username={user?.username} role={user?.role}>
      <Head>
        <title>应用管理 · Expo Updates</title>
      </Head>
      <Space direction="vertical" size="large" className="page-stack">
        <div className="page-heading">
          <div>
            <Typography.Title level={2}>应用管理</Typography.Title>
            <Typography.Paragraph type="secondary">
              管理应用、审核热更新并查看发布历史。
            </Typography.Paragraph>
          </div>
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
            {user?.role === 'admin' && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setOpen(true);
                }}
              >
                新建应用
              </Button>
            )}
          </Space>
        </div>
        {error && <Alert type="error" showIcon message={error} />}
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic title="应用数量" value={apps.length} />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="更新记录"
                value={apps.reduce((sum, app) => sum + Number(app.updateCount), 0)}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="待审核"
                value={apps.reduce((sum, app) => sum + Number(app.pendingCount), 0)}
                valueStyle={{ color: '#d48806' }}
              />
            </Card>
          </Col>
        </Row>
        <Row gutter={[16, 16]}>
          {apps.map((app) => (
            <Col xs={24} md={12} xl={8} key={app.slug}>
              <Card className="application-card" loading={loading}>
                <Space direction="vertical" size="middle" className="full-width">
                  <div className="card-title-row">
                    <div>
                      <Typography.Title level={4}>{app.name}</Typography.Title>
                      <Typography.Text code>{app.slug}</Typography.Text>
                    </div>
                    <Tag color={app.pendingCount ? 'gold' : 'default'}>
                      {app.pendingCount} 待审核
                    </Tag>
                  </div>
                  <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }}>
                    {app.description || '暂无说明'}
                  </Typography.Paragraph>
                  <div className="card-footer">
                    <Typography.Text type="secondary">{app.updateCount} 条更新记录</Typography.Text>
                    <Link href={`/apps/${app.slug}`}>
                      <Button type="link" icon={<RightOutlined />} iconPlacement="end">
                        进入管理
                      </Button>
                    </Link>
                  </div>
                </Space>
              </Card>
            </Col>
          ))}
          {!loading && apps.length === 0 && (
            <Col span={24}>
              <Card>
                <Typography.Text type="secondary">暂无应用。请由管理员创建应用。</Typography.Text>
              </Card>
            </Col>
          )}
        </Row>
      </Space>
      <Modal
        title="新建应用"
        open={open}
        onCancel={() => {
          setOpen(false);
        }}
        onOk={() => {
          form.submit();
        }}
        confirmLoading={creating}
        okText="创建应用"
        cancelText="取消"
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          应用标识需与 Expo 项目的 slug 对应。
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={(values) => void createApp(values)}>
          <Form.Item
            name="slug"
            label="应用标识"
            rules={[
              { required: true },
              { min: 2, max: 80 },
              { pattern: /^[a-z0-9][a-z0-9-]+$/, message: '请使用小写字母、数字和连字符' },
            ]}
          >
            <Input placeholder="例如 rntest" />
          </Form.Item>
          <Form.Item name="name" label="应用名称" rules={[{ required: true }, { max: 120 }]}>
            <Input placeholder="应用显示名称" />
          </Form.Item>
          <Form.Item name="description" label="说明" rules={[{ max: 500 }]}>
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </AdminShell>
  );
}
