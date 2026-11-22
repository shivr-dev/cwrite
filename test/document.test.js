import assert from 'node:assert/strict'
import {test} from 'node:test'
import {JSDOM} from 'jsdom'
import * as Y from 'yjs'

test('DOCX round trip preserves common formatting and room carets stay out of the document', async () => {
  const dom = new JSDOM('<main><div id="source"></div><div id="peer"></div></main>',{pretendToBeVisual:true})
  const w = dom.window
  Object.assign(globalThis,{window:w,document:w.document,DOMParser:w.DOMParser,XMLSerializer:w.XMLSerializer,
    Node:w.Node,HTMLElement:w.HTMLElement,getComputedStyle:w.getComputedStyle.bind(w),
    requestAnimationFrame:w.requestAnimationFrame.bind(w),cancelAnimationFrame:w.cancelAnimationFrame.bind(w)})
  const {exportDocx,importDocx} = await import('../src/docx.js')
  const {createEditor} = await import('../src/editor.js')
  const {encodeCaret,showCarets} = await import('../src/carets.js')
  const report = {
    type:'doc',content:[
      {type:'heading',attrs:{level:2},content:[{type:'text',text:'实验记录'}]},
      {type:'paragraph',attrs:{textAlign:'center',wordIndent:'18pt',lineHeight:'1.5'},content:[{
        type:'text',text:'二氧化碳',marks:[
          {type:'bold'},{type:'subscript'},{type:'textStyle',attrs:{fontSize:'14pt',color:'#a12626',fontFamily:'SimSun'}},
          {type:'highlight',attrs:{color:'#fff1a6'}},
        ],
      }]},
    ],
  }
  const file = await exportDocx('格式测试',report)
  const converted = await importDocx({name:'格式测试.docx',size:file.size,arrayBuffer:()=>file.arrayBuffer()})
  assert.match(converted.html,/<h2[^>]*>.*实验记录.*<\/h2>/)
  assert.match(converted.html,/text-align: center/)
  assert.match(converted.html,/margin-left: 18pt/)
  assert.match(converted.html,/line-height: 1.5/)
  assert.match(converted.html,/font-size: 14pt/)
  assert.match(converted.html,/font-family: "SimSun"|font-family: &quot;SimSun&quot;|font-family: SimSun/)
  assert.match(converted.html,/rgb\(161, 38, 38\)|#a12626/)
  assert.match(converted.html,/<sub>/)
  assert.match(converted.html,/<mark/)
  const doc = new Y.Doc(), peerDoc = new Y.Doc()
  const source = createEditor(w.document.querySelector('#source'),doc,true,()=>{})
  try {
    source.commands.setContent(converted.html)
    assert.match(source.getHTML(),/margin-left:\s*18pt/)
    assert.match(source.getHTML(),/font-size:\s*14pt/)
    assert.match(source.getHTML(),/<mark/)
    source.commands.setTextSelection(3)
    source.view.focus()
    const caret = encodeCaret(source)
    assert.ok(caret)
    Y.applyUpdate(peerDoc,Y.encodeStateAsUpdate(doc))
    const peer = createEditor(w.document.querySelector('#peer'),peerDoc,true,()=>{})
    try {
      showCarets(peer,[{author:'114a0000-0000-4000-8000-000000000000',caret,name:'测试队友'}])
      assert.equal(peer.view.dom.querySelector('.collaborator-caret span')?.textContent,'测试队友')
      assert.doesNotMatch(peer.getHTML(),/测试队友/)
    } finally { peer.destroy() }
  } finally { source.destroy(); doc.destroy(); peerDoc.destroy(); dom.window.close() }
})
