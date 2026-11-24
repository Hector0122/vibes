import { clock, seekTime } from '../components/SeekBar'

it('clock: minutes, and hours for long audiobooks', () => {
  expect(clock(0)).toBe('0:00')
  expect(clock(125.9)).toBe('2:05')
  expect(clock(7007)).toBe('1:56:47')
  expect(clock(-3)).toBe('0:00')
})

it('seekTime: where a touch lands, kept inside the song', () => {
  expect(seekTime(100, 200, 66221)).toBe(33110.5)
  expect(seekTime(-10, 200, 300)).toBe(0)
  expect(seekTime(250, 200, 300)).toBe(300)
  expect(seekTime(50, 0, 300)).toBe(0) // not laid out yet
  expect(seekTime(50, 200, 0)).toBe(0) // length unknown
})
