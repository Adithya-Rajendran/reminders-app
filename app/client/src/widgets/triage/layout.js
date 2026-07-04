import { atLeastH, atLeastW, atMostH, atMostW } from '../../widget-sdk'

export function getTriageLayout(size) {
  const compact = atMostW(size, 'sm')
  const short = atMostH(size, 'sm')
  const roomyWidth = atLeastW(size, 'lg')
  const roomyHeight = atLeastH(size, 'lg')
  const roomy = roomyWidth || roomyHeight

  return {
    compact,
    short,
    showWhy: atLeastH(size, 'sm'),
    showSubtitles: roomyWidth && !compact,
    matrixMode: compact ? 'stack' : 'grid',
    roomy,
    rowCap: compact ? (roomyHeight ? 4 : 3) : roomy ? 12 : 8,
  }
}
