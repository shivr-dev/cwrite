import {Extension} from '@tiptap/core'
import {Plugin,PluginKey} from '@tiptap/pm/state'
import {Decoration,DecorationSet} from '@tiptap/pm/view'
import {absolutePositionToRelativePosition,relativePositionToAbsolutePosition,ySyncPluginKey} from '@tiptap/y-tiptap'
import * as Y from 'yjs'

const caretKey = new PluginKey('ctbCarets')
const colors = ['#155d4d','#7a3e96','#9b471b','#20578b','#963b64','#69531b']

export const CollaboratorCarets = Extension.create({
  name:'ctbCarets',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      key:caretKey,
      state:{
        init:()=>[],
        apply:(transaction,current)=>transaction.getMeta(caretKey) ?? current,
      },
      props:{
        decorations(state) {
          const yState = ySyncPluginKey.getState(state)
          const mapping = yState?.binding?.mapping
          if (!mapping) return DecorationSet.empty
          const decorations = []
          for (const entry of caretKey.getState(state)) {
            try {
              const bytes = Uint8Array.from(atob(entry.caret), value=>value.charCodeAt(0))
              const relative = Y.decodeRelativePosition(bytes)
              const position = relativePositionToAbsolutePosition(yState.doc,yState.type,relative,mapping)
              if (position === null || position < 0 || position > state.doc.content.size) continue
              decorations.push(Decoration.widget(position,() => {
                const marker = document.createElement('span')
                marker.className = 'collaborator-caret'
                marker.contentEditable = 'false'
                marker.setAttribute('aria-hidden','true')
                const color = Number.parseInt(entry.author.slice(0,4),16) % colors.length
                marker.style.setProperty('--caret-color',colors[color] || colors[0])
                const label = document.createElement('span')
                label.textContent = entry.name
                marker.append(label)
                return marker
              },{side:1,key:entry.author+':'+entry.caret+':'+entry.name,ignoreSelection:true}))
            } catch { /* A deleted or incompatible position has no caret to display. */ }
          }
          return editor.isDestroyed ? DecorationSet.empty : DecorationSet.create(state.doc,decorations)
        },
      },
    })]
  },
})

export function encodeCaret(editor) {
  if (!editor || editor.isDestroyed || !editor.view.hasFocus()) return null
  const state = ySyncPluginKey.getState(editor.state)
  if (!state?.binding?.mapping) return null
  try {
    const relative = absolutePositionToRelativePosition(editor.state.selection.head,state.type,state.binding.mapping)
    return btoa(String.fromCharCode(...Y.encodeRelativePosition(relative)))
  } catch { return null }
}

export function showCarets(editor, active) {
  if (!editor || editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(caretKey,active).setMeta('addToHistory',false))
}
