import { useEffect, useRef, useState, useCallback } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws'
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export function useWebSocket() {
  const ws = useRef(null)
  const pendingNodes = useRef(null)
  const pendingFl = useRef(null)

  const [nodes, setNodes] = useState([])
  const [alerts, setAlerts] = useState([])
  const [fl, setFl] = useState(null)
  const [connected, setConnected] = useState(false)
  const [mqttLog, setMqttLog] = useState([])
  const [sanitLog, setSanitLog] = useState([])

  // Throttle node/FL updates to 1000ms
  useEffect(() => {
    const id = setInterval(() => {
      if (pendingNodes.current) {
        setNodes(pendingNodes.current)
        pendingNodes.current = null
      }

      if (pendingFl.current) {
        setFl(pendingFl.current)
        pendingFl.current = null
      }
    }, 1000)

    return () => clearInterval(id)
  }, [])

  // WebSocket connection
  useEffect(() => {
    function connect() {
      ws.current = new WebSocket(WS_URL)

      ws.current.onopen = () => {
        setConnected(true)
      }

      ws.current.onclose = () => {
        setConnected(false)
        setTimeout(connect, 2000)
      }

      ws.current.onmessage = (e) => {
        const msg = JSON.parse(e.data)

        // Initial state / regular state updates
        if (msg.type === 'init' || msg.type === 'state_update') {
          if (msg.nodes?.length) {
            pendingNodes.current = msg.nodes
          }

          if (msg.fl) {
            pendingFl.current = msg.fl
          }

          if (msg.alerts?.length) {
            setAlerts((prev) => {
              const ids = new Set(prev.map((a) => a.id))
              const fresh = msg.alerts.filter(
                (a) => !ids.has(a.id)
              )

              return [...fresh, ...prev].slice(0, 100)
            })
          }
        }

        // Node added
        if (msg.type === 'node_added') {
          setNodes((prev) => [...prev, msg.node])
        }

        // Node removed
        if (msg.type === 'node_removed') {
          setNodes((prev) =>
            prev.filter((n) => n.id !== msg.node_id)
          )
        }

        // Node isolated
        if (msg.type === 'node_isolated') {
          setNodes((prev) =>
            prev.map((n) =>
              n.id === msg.node_id
                ? {
                    ...n,
                    status: 'isolated',
                    isIsolated: true,
                  }
                : n
            )
          )

          if (msg.alert) {
            setAlerts((prev) =>
              [msg.alert, ...prev].slice(0, 100)
            )
          }
        }

        // Node restored
        if (msg.type === 'node_restored') {
          setNodes((prev) =>
            prev.map((n) =>
              n.id === msg.node_id
                ? {
                    ...n,
                    status: 'normal',
                    isIsolated: false,
                  }
                : n
            )
          )
        }

        // --------------------------------------------------
        // Sanitization started
        // --------------------------------------------------

        if (msg.type === 'sanitization_started') {
          setNodes((prev) =>
            prev.map((n) =>
              n.id === msg.node_id
                ? {
                    ...n,
                    status: 'sanitizing',
                  }
                : n
            )
          )

          setSanitLog((prev) => [
            {
              time: new Date()
                .toTimeString()
                .slice(0, 8),
              node: msg.node_name,
              message: `Sanitization started for ${msg.node_name}`,
              type: 'start',
            },
            ...prev,
          ].slice(0, 50))
        }

        // Sanitization progress
        if (msg.type === 'sanitization_progress') {
          const statusMap = {
            block_ip: 'sanitizing',
            purge_queue: 'sanitizing',
            fl_model_reset: 'sanitizing',
            health_check: 'health_check',
          }

          setNodes((prev) =>
            prev.map((n) =>
              n.id === msg.node_id
                ? {
                    ...n,
                    status:
                      statusMap[msg.phase] ||
                      'sanitizing',
                    sanitStep: msg.step,
                    sanitTotal: msg.total_steps,
                    flRoundRestored: msg.fl_round,
                  }
                : n
            )
          )

          setSanitLog((prev) => [
            {
              time: new Date()
                .toTimeString()
                .slice(0, 8),
              node: msg.node_id,
              message: msg.message,
              type: msg.phase,
            },
            ...prev,
          ].slice(0, 50))

          setMqttLog((prev) => [
            {
              topic: `canarymesh/${msg.node_id}/sanitize`,
              payload: msg.message,
              time: new Date()
                .toTimeString()
                .slice(0, 8),
              type: 'SYSTEM',
            },
            ...prev,
          ].slice(0, 30))
        }

        // Sanitization complete
        if (msg.type === 'sanitization_complete') {
          setNodes((prev) =>
            prev.map((n) =>
              n.id === msg.node_id
                ? {
                    ...n,
                    status: msg.passed
                      ? 'ready_reconnect'
                      : 'isolated',
                    sanitStep: null,
                  }
                : n
            )
          )

          setSanitLog((prev) => [
            {
              time: new Date()
                .toTimeString()
                .slice(0, 8),
              node: msg.node_name,
              message: msg.message,
              type: msg.passed
                ? 'passed'
                : 'failed',
              auditEntries: msg.audit_entries,
            },
            ...prev,
          ].slice(0, 50))
        }

        // Node reconnected
        if (msg.type === 'node_reconnected') {
          setNodes((prev) =>
            prev.map((n) =>
              n.id === msg.node_id
                ? {
                    ...n,
                    status: 'normal',
                    isIsolated: false,
                    sanitStep: null,
                  }
                : n
            )
          )

          setSanitLog((prev) => [
            {
              time: new Date()
                .toTimeString()
                .slice(0, 8),
              node: msg.node_name,
              message: msg.message,
              type: 'reconnected',
            },
            ...prev,
          ].slice(0, 50))

          setAlerts((prev) => [
            {
              id: Date.now().toString(),
              nodeId: msg.node_id,
              node: msg.node_name,
              time: new Date()
                .toTimeString()
                .slice(0, 8),
              severity: 'LOW',
              reason: msg.message,
            },
            ...prev,
          ].slice(0, 100))
        }

        // Alert approved
        if (msg.type === 'alert_approved') {
          setAlerts((prev) =>
            prev.map((a) =>
              a.id === msg.alert_id
                ? {
                    ...a,
                    severity: 'HIGH',
                  }
                : a
            )
          )
        }

        // Alerts cleared
        if (msg.type === 'alerts_cleared') {
          setAlerts([])
        }

        // Attack simulated
        if (msg.type === 'attack_simulated') {
          const attackedNode =
            pendingNodes.current?.find(
              (n) => n.id === msg.node_id
            )

          const sample = attackedNode?.mqttSample

          setMqttLog((prev) => [
            {
              topic:
                sample?.topic ||
                `factory/node-${msg.node_id}/cmd`,

              payload:
                sample?.payload ||
                `WRITE reg=0x40 val=0xDEAD | intensity=${msg.intensity}`,

              time: new Date()
                .toTimeString()
                .slice(0, 8),

              type: 'ATTACK',

              destination: 'UNKNOWN_IP',

              command: 'WRITE',
            },
            ...prev,
          ].slice(0, 30))
        }
      }
    }

    // IMPORTANT:
    // These are OUTSIDE function connect()
    connect()

    return () => {
      ws.current?.close()
    }
  }, [])

  const send = useCallback((data) => {
    if (
      ws.current?.readyState ===
      WebSocket.OPEN
    ) {
      ws.current.send(JSON.stringify(data))
    }
  }, [])

  return {
    nodes,
    alerts,
    fl,
    connected,
    mqttLog,
    sanitLog,

    isolateNode: (id) =>
      send({
        action: 'isolate',
        node_id: id,
      }),

    sanitizeNode: (id) =>
      send({
        action: 'sanitize',
        node_id: id,
      }),

    reconnectNode: (id) =>
      send({
        action: 'reconnect',
        node_id: id,
      }),

    restoreNode: (id) =>
      send({
        action: 'restore',
        node_id: id,
      }),

    approveAlert: (id) =>
      send({
        action: 'approve_isolation',
        alert_id: id,
      }),

    clearAlerts: () =>
      send({
        action: 'clear_alerts',
      }),

    addNode: (name, type, traffic) =>
      send({
        action: 'add_node',
        name,
        node_type: type,
        base_traffic: traffic,
      }),

    removeNode: (id) =>
      send({
        action: 'remove_node',
        node_id: id,
      }),

    simulateAttack: (id, intensity) =>
      send({
        action: 'simulate_attack',
        node_id: id,
        intensity,
      }),

    triggerHoneypot: () =>
      fetch(
        `${API_URL}/api/simulate/honeypot_probe`,
        {
          method: 'POST',
        }
      ),
  }
}