import { Layout, List, Tag } from 'antd'
import { TraceEvent } from '@openclaw-view/shared'

const { Sider } = Layout

interface Props {
  events: TraceEvent[]
  selectedEvent: TraceEvent | null
  onSelect: (event: TraceEvent) => void
}

const eventColors: Record<string, string> = {
  'message:received': 'blue',
  'message:sent': 'green',
  'prompt:build': 'orange',
  'model:resolve': 'purple',
  'agent:end': 'cyan'
}

export default function EventList({ events, selectedEvent, onSelect }: Props) {
  return (
    <Sider width={400} style={{ background: '#141414', overflow: 'auto' }}>
      <List
        dataSource={events}
        renderItem={(event) => (
          <List.Item
            style={{
              cursor: 'pointer',
              background: selectedEvent?.seq === event.seq ? '#1f1f1f' : 'transparent',
              padding: '12px 16px'
            }}
            onClick={() => onSelect(event)}
          >
            <div style={{ width: '100%' }}>
              <div style={{ marginBottom: 4 }}>
                <Tag color={eventColors[event.eventType] || 'default'}>
                  {event.eventType}
                </Tag>
                <span style={{ color: '#888', fontSize: 12 }}>seq: {event.seq}</span>
              </div>
              <div style={{ color: '#aaa', fontSize: 12 }}>
                {new Date(event.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </List.Item>
        )}
      />
    </Sider>
  )
}
