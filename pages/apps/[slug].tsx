import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';

import AdminShell from '../../components/AdminShell';

type Application = { slug: string; name: string; description: string };
type Release = {
  id: number;
  runtimeVersion: string;
  release: string;
  updateId: string;
  message: string;
  status: string;
  directory: string;
  createdAt: string;
  publishedAt: string | null;
  uploadedBy: string | null;
  reviewedBy: string | null;
  isCurrent: number;
  androidDetected: number;
  androidDownloaded: number;
  androidSucceeded: number;
  androidFailed: number;
  iosDetected: number;
  iosDownloaded: number;
  iosSucceeded: number;
  iosFailed: number;
};
type User = { username: string; role: string };

const statusLabel: Record<string, string> = {
  pending: '待审核',
  published: '已发布',
  rejected: '已拒绝',
  withdrawn: '已撤回',
};
const statusColor: Record<string, string> = {
  pending: 'gold',
  published: 'green',
  rejected: 'red',
  withdrawn: 'default',
};

export default function AppDetailPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === 'string' ? router.query.slug : '';
  const [app, setApp] = useState<Application | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [user, setUser] = useState<User>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const auth = await fetch('/api/auth/me');
      if (!auth.ok) {
        window.location.href = '/login';
        return;
      }
      const authBody = await auth.json();
      setUser(authBody.user);
      const [appResponse, updatesResponse] = await Promise.all([
        fetch(`/api/apps/${slug}`),
        fetch(`/api/apps/${slug}/updates`),
      ]);
      const [appBody, updatesBody] = await Promise.all([
        appResponse.json(),
        updatesResponse.json(),
      ]);
      if (!appResponse.ok) throw new Error(appBody.error ?? '读取应用失败');
      if (!updatesResponse.ok) throw new Error(updatesBody.error ?? '读取更新失败');
      setApp(appBody);
      form.setFieldsValue({ name: appBody.name, description: appBody.description });
      setReleases(updatesBody);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取应用失败');
    } finally {
      setLoading(false);
    }
  }, [slug, form]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveApp(values: { name: string; description?: string }) {
    const response = await fetch(`/api/apps/${slug}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
    const body = await response.json();
    if (!response.ok) {
      message.error(body.error ?? '保存失败');
      return;
    }
    setApp(body);
    message.success('应用信息已保存');
  }

  async function action(release: Release, actionName: string) {
    setError('');
    const response = await fetch(`/api/updates/${release.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: actionName }),
    });
    const body = await response.json();
    if (!response.ok) {
      message.error(body.error ?? '操作失败');
      return;
    }
    const success: Record<string, string> = {
      publish: '更新已发布',
      withdraw: '更新已撤回',
      reject: '更新已拒绝',
      delete: '更新已删除',
    };
    message.success(success[actionName]);
    await load();
  }

  async function deactivate() {
    const response = await fetch(`/api/apps/${slug}`, { method: 'DELETE' });
    const body = await response.json();
    if (!response.ok) {
      message.error(body.error ?? '停用失败');
      return;
    }
    message.success('应用已停用');
    await router.push('/');
  }

  const columns: TableProps<Release>['columns'] = [
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (status: string, record) => (
        <Space wrap>
          <Tag color={statusColor[status]}>{statusLabel[status] ?? status}</Tag>
          {Boolean(record.isCurrent) && <Tag color="blue">当前生效</Tag>}
        </Space>
      ),
    },
    { title: 'Runtime', dataIndex: 'runtimeVersion', width: 130 },
    {
      title: 'Android 统计',
      key: 'androidAnalytics',
      width: 230,
      render: (_, release) => renderPlatformMetrics(release, 'android'),
    },
    {
      title: 'iOS 统计',
      key: 'iosAnalytics',
      width: 230,
      render: (_, release) => renderPlatformMetrics(release, 'ios'),
    },
    {
      title: '更新说明',
      dataIndex: 'message',
      render: (messageText: string) =>
        messageText || <Typography.Text type="secondary">未填写更新说明</Typography.Text>,
    },
    { title: '发布编号', dataIndex: 'release', width: 150, ellipsis: true },
    { title: '更新 ID', dataIndex: 'updateId', width: 180, ellipsis: true },
    {
      title: '上传人',
      dataIndex: 'uploadedBy',
      width: 120,
      render: (value: string | null) => value ?? '旧版本导入',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 245,
      render: (_, release) => (
        <Space wrap>
          {release.status === 'pending' && (
            <>
              <Popconfirm
                title="确认发布这条更新？"
                description="发布后兼容该 Runtime 的客户端会收到更新。"
                onConfirm={() => void action(release, 'publish')}
              >
                <Button type="primary" size="small">
                  发布
                </Button>
              </Popconfirm>
              <Popconfirm
                title="拒绝这条待审核更新？"
                onConfirm={() => void action(release, 'reject')}
              >
                <Button size="small">拒绝</Button>
              </Popconfirm>
            </>
          )}
          {release.status === 'published' && (
            <Popconfirm
              title="撤回这条更新？"
              description="客户端将回到此前最新的已发布版本。"
              onConfirm={() => void action(release, 'withdraw')}
            >
              <Button danger size="small">
                撤回
              </Button>
            </Popconfirm>
          )}
          {release.status !== 'published' && user?.role === 'admin' && (
            <Popconfirm
              title="永久删除这条未发布更新及其文件？"
              onConfirm={() => void action(release, 'delete')}
            >
              <Button danger type="text" size="small">
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <AdminShell username={user?.username} role={user?.role}>
      <Head>
        <title>{app?.name ?? '应用更新'} · Expo Updates</title>
      </Head>
      <Space direction="vertical" size="large" className="page-stack">
        <div className="page-heading">
          <div>
            <Typography.Text type="secondary">
              <Link href="/">应用管理</Link> / {slug}
            </Typography.Text>
            <Typography.Title level={2}>{app?.name ?? '应用更新'}</Typography.Title>
            <Typography.Paragraph type="secondary">
              审核更新、撤回故障版本，或发布新修复包。
            </Typography.Paragraph>
          </div>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        </div>
        {error && <Alert type="error" showIcon message={error} />}
        {user?.role === 'admin' && (
          <Card
            title="应用设置"
            extra={
              <Popconfirm
                title="停用此应用？"
                description="历史记录会保留，客户端将不再获取新更新。"
                onConfirm={() => void deactivate()}
              >
                <Button danger>停用应用</Button>
              </Popconfirm>
            }
          >
            <Form form={form} layout="vertical" onFinish={(values) => void saveApp(values)}>
              <div className="settings-form">
                <Form.Item name="name" label="名称" rules={[{ required: true }, { max: 120 }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="description" label="说明" rules={[{ max: 500 }]}>
                  <Input maxLength={500} />
                </Form.Item>
                <Form.Item className="settings-submit">
                  <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
                    保存
                  </Button>
                </Form.Item>
              </div>
            </Form>
          </Card>
        )}
        {app && (
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 3 }}
            items={[
              { key: 'slug', label: '应用标识', children: app.slug },
              { key: 'name', label: '应用名称', children: app.name },
              {
                key: 'pending',
                label: '待审核',
                children: releases.filter((item) => item.status === 'pending').length,
              },
            ]}
          />
        )}
        <Card
          title="更新记录"
          extra={
            <Typography.Text type="secondary">撤回后自动切回此前最新的已发布更新</Typography.Text>
          }
        >
          <Typography.Paragraph type="secondary">
            设备按匿名安装 ID
            去重；成功率按已确认启动成功或失败的设备计算，待确认设备不会计入成功率。
          </Typography.Paragraph>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={releases}
            loading={loading}
            scroll={{ x: 1650 }}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        </Card>
      </Space>
    </AdminShell>
  );
}

function renderPlatformMetrics(release: Release, platform: 'android' | 'ios') {
  const detected = Number(release[`${platform}Detected`]);
  const downloaded = Number(release[`${platform}Downloaded`]);
  const succeeded = Number(release[`${platform}Succeeded`]);
  const failed = Number(release[`${platform}Failed`]);
  const resolved = succeeded + failed;
  const pending = Math.max(downloaded - resolved, 0);
  const rate = resolved ? `${((succeeded / resolved) * 100).toFixed(1)}%` : '—';
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text>
        成功 {succeeded} · 失败 {failed}
      </Typography.Text>
      <Typography.Text type="secondary">
        检测 {detected} · 下载 {downloaded} · 待确认 {pending} · 成功率 {rate}
      </Typography.Text>
    </Space>
  );
}
