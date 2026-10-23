import {describe,it,expect} from 'bun:test'
import {processEvent} from '../../processor'
import {groupMessagesByTurn} from '../../../../../../../packages/ui/src/components/chat/turn-utils'
import type {SessionState} from '../../types'
function initial():SessionState {return {session:{id:'s',messages:[],isProcessing:true,lastMessageAt:1} as any,streaming:null}}
describe('transient transport progress',()=>{
 it('updates the live indicator without appending transcript steps',()=>{
  let state=initial()
  for(const message of ['Connecting to agent-compose…','Remote agent is working…','Connection interrupted. Reconnecting to the remote run…']){
   state=processEvent(state,{type:'status',sessionId:'s',message}).state
   expect(state.session.currentStatus?.message).toBe(message)
   expect(state.session.messages).toHaveLength(0)
  }
  state=processEvent(state,{type:'complete',sessionId:'s'}).state
  expect(state.session.currentStatus).toBeUndefined()
 })
 it('does not count connection rows retained by an older client as completed steps',()=>{
  const turns=groupMessagesByTurn([
   {id:'u',role:'user',content:'你好',timestamp:1},
   {id:'status',role:'status',content:'Connecting to agent-compose…',timestamp:2},
   {id:'a',role:'assistant',content:'你好！',timestamp:3},
  ] as any,{isSessionProcessing:false})
  const assistant=turns.find(t=>t.type==='assistant')
  expect(assistant?.type==='assistant'&&assistant.activities).toEqual([])
 })
 it('preserves compaction activities',()=>{
  const state=processEvent(initial(),{type:'status',sessionId:'s',message:'Compacting context...',statusType:'compacting'}).state
  expect(state.session.messages).toHaveLength(1)
  expect(state.session.messages[0]?.statusType).toBe('compacting')
 })
})
