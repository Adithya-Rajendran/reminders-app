import { Component } from 'react'

// A failed dynamic import (lazy widget chunk) almost always means a new build was
// deployed under a long-lived tab: the in-memory index.html points at chunk hashes
// the server no longer has, so the fetch 404s. Detect that and reload once to pick
// up the fresh index.html + hashes.
const isChunkError = (e) => /dynamically imported module|loading chunk|module script failed|importing a module script/i.test(e?.message || '')
const RELOAD_FLAG = 'wb-chunk-reloaded'

// Error boundary around each widget so one widget that fails to load/render can't
// blank the whole dashboard (the refactor made widgets lazy — without this, a
// Suspense chunk-load error throws uncaught and takes the board down).
export default class WidgetBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(err) {
    if (isChunkError(err)) {
      try {
        if (!sessionStorage.getItem(RELOAD_FLAG)) { sessionStorage.setItem(RELOAD_FLAG, '1'); window.location.reload() }
      } catch { /* sessionStorage blocked — fall through to the manual Reload button */ }
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="widget-load-err">
          <div className="state-sub">This widget couldn’t load.</div>
          <button className="btn sm" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}
