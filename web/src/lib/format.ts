import type { Answer, Blank, Group } from '../api/types'

/** 單題直接顯示答案；題組以「（1）CPU；（2）作業系統」顯示 */
export function formatAnswers(blanks: Blank[], answers: Answer[]): string {
  if (blanks.length <= 1) return answers[0]?.text ?? ''
  return blanks
    .map((b) => `${b.label ?? ''}${answers.find((a) => a.blankId === b.id)?.text ?? ''}`)
    .join('；')
}

export function groupName(groups: Group[], id: string | null | undefined): string {
  return groups.find((g) => g.id === id)?.name ?? ''
}

export const STATUS_TEXT = { idle: '未開始', open: '進行中', closed: '已結束' } as const
export const GROUP_STATUS_TEXT = { idle: '未作答', editing: '編輯中', submitted: '已送出' } as const
