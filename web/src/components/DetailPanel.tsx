import { Layout, Card, Descriptions, Empty } from 'antd'
import { TraceEvent } from '@openclaw-view/shared'

const { Content } = Layout

interface Props {
  event: TraceEvent | null
}

export default function DetailPanel({ event }: Props) {
  if (!event) {
    return (
      <Content style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description="Select an event to view details" />
      </Content>
    )
  }

  return (
    <Content style={{ padding: 24, overflow: 'auto' }}>
      <Card title="Event Details">
        <Descriptions column={1} bordered>
          <Descriptions.Item label="Type">{event.eventType}</Descriptions.Item>
          <Descriptions.Item label="Sequence">{event.seq}</Descriptions.Item>
          <Descriptions.Item label="Timestamp">{new Date(event.timestamp).toLocaleString()}</Descriptions.Item>
          {event.project && <Descriptions.Item label="Project">{event.project}</Descriptions.Item>}
        </Descriptions>
      </Card>
      
      {event.payload && (
        <Card title="Payload" style={{ marginTop: 16 }}>
          <pre style={{ background: '#1f1f1f', padding: 16, borderRadius: 4, overflow: 'auto' }}>
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </Card>
      )}
    </Content>
  )
}
