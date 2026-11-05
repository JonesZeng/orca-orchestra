import '../../../assets/main.css'
import ReactDOM from 'react-dom/client'
import { translate } from '@/i18n/i18n'
import { readOrcaPanelFrame } from './orca-panel-frame'
import { followOrcaFrameTheme, followOrcaLocale } from './orchestra-plugin-frame-presentation'
import { OrchestraPluginFrame } from './OrchestraPluginFrame'

const frame = readOrcaPanelFrame()
const root = document.getElementById('root')

if (root) {
  followOrcaFrameTheme()
  // The host's hello (locale, methods) and every theme change arrive as a `theme` event.
  frame?.on('theme', () => {
    followOrcaFrameTheme()
    void followOrcaLocale(frame.locale)
  })
  void followOrcaLocale(frame?.locale ?? navigator.language)
  ReactDOM.createRoot(root).render(
    frame ? (
      <OrchestraPluginFrame frame={frame} />
    ) : (
      <p className="p-4 text-sm">
        {translate('orchestra.pluginFrame.noHost', 'Open this panel from Orca.')}
      </p>
    )
  )
}
