import { useState, useEffect } from 'react'
import { ConfigProvider, Layout, theme } from 'antd'
import { TraceEvent } from '@openclaw-view/shared'
import EventList from './components/EventList'
import DetailPanel from './components/DetailPanel'

const { Header, Content } = Layout

function App() {
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [selectedEvent, setSelectedEvent] = useState<TraceEvent | null>(null)

  useEffect(() => {
    fetch('/trace/api/events')
      .then(res => res.json())
      .then(data => setEvents(data.events || []))
      .catch(console.error)
  }, [])

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <Layout style={{ height: '100vh' }}>
        <Header style={{ padding: '0 24px', display: 'flex', alignItems: 'center' }}>
          <h2 style={{ color: '#fff', margin: 0 }}>OpenClaw Trace Viewer</h2>
        </Header>
        <Layout>
          <EventList
            events={events}
            selectedEvent={selectedEvent}
            onSelect={setSelectedEvent}
          />
          <DetailPanel event={selectedEvent} />
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}

export default App
