import {fontFamilies,lineHeights} from './editor.js'

const options = entries => entries.map(([value,label]) => '<option value="' + value + '">' + label + '</option>').join('')
const item = (id,label,icon = label) => '<button type="button" id="' + id + '" title="' + label + '" aria-label="' + label + '">' + icon + '</button>'
const command = (name,label,icon,mark = '') => '<button type="button" data-command="' + name + '" ' +
  (mark ? 'data-mark="' + mark + '" aria-pressed="false" ' : '') + 'title="' + label + '" aria-label="' + label + '">' + icon + '</button>'
const select = (id,label,entries) => '<select id="' + id + '" title="' + label + '" aria-label="' + label + '">' + options(entries) + '</select>'
const group = (label,first,second) => '<div class="ribbon-group" role="group" aria-label="' + label + '"><div class="ribbon-row">' +
  first + '</div><div class="ribbon-row">' + second + '</div><span class="ribbon-label" aria-hidden="true">' + label + '</span></div>'

const pointSizes = [8,9,10,10.5,11,12,14,16,18,20,22,24,28,32,36,48,72]
const sizeLabel = {10.5:'五号 · 10.5',12:'小四 · 12',14:'四号 · 14',16:'三号 · 16',18:'小二 · 18'}
const fontLabels = ['微软雅黑','宋体','楷体','Arial','Times New Roman']
const ink = [['','自动颜色'],['#283a34','墨黑'],['#a12626','红色'],['#155d4d','绿色'],['#2351a1','蓝色'],['#774095','紫色']]
const highlights = [['','无高亮'],['#fff1a6','浅黄'],['#c8edd9','浅绿'],['#cbe4fb','浅蓝'],['#f7d2df','浅粉']]
const markNames = ['bold','italic','underline','strike','subscript','superscript','textStyle','highlight']
const blockAttributes = ['textAlign','indent','lineHeight','wordIndent','wordRightIndent','firstLineIndent','spaceBefore','spaceAfter']

export const ribbon = [
  group('剪贴板',item('paste','粘贴')+item('cut','剪切')+item('copy','复制'),
    command('undo','撤销','↶')+command('redo','重做','↷')+item('paint','格式刷')),
  group('字体',select('fontFamily','字体',[['','默认字体'],...fontFamilies.map((font,i)=>[font,fontLabels[i]])])+
    select('fontSize','字号',[['','字号'],...pointSizes.map(size=>[size+'pt',sizeLabel[size] || size+' 磅'])])+
    item('larger','增大字号','A＋')+item('smaller','减小字号','A−')+item('clearFormat','清除格式','清除'),
    command('toggleBold','加粗 (Ctrl+B)','<b>B</b>','bold')+
    command('toggleItalic','斜体 (Ctrl+I)','<i>I</i>','italic')+
    command('toggleUnderline','下划线 (Ctrl+U)','<u>U</u>','underline')+
    command('toggleStrike','删除线','<s>S</s>','strike')+
    command('toggleSubscript','下标','x₂','subscript')+
    command('toggleSuperscript','上标','x²','superscript')+
    select('fontColor','文字颜色',ink)+select('highlight','高亮颜色',highlights)),
  group('段落',command('toggleBulletList','项目列表','•≡','bulletList')+
    command('toggleOrderedList','编号列表','₁≡','orderedList')+
    item('indentLess','减少缩进','⇤')+item('indentMore','增加缩进','⇥')+
    select('lineHeight','行距',[['','行距'],...lineHeights.map(value=>[value,value+' 倍'])]),
    select('align','文字对齐',[['left','左对齐'],['center','居中'],['right','右对齐'],['justify','两端对齐']])+
    command('toggleBlockquote','引用','❝','blockquote')+item('link','链接')+item('table','表格')),
  group('段落样式',select('heading','段落样式',[['0','正文'],['1','标题 1'],['2','标题 2'],['3','标题 3']]),''),
].join('')

function updateParagraphs(editor, values) {
  const {state,view} = editor
  const {from,to,$from} = state.selection
  const transaction = state.tr
  function apply(node,pos) {
    if (!['paragraph','heading'].includes(node.type.name)) return
    transaction.setNodeMarkup(pos,undefined,{...node.attrs,...values(node.attrs)})
  }
  if (from === to && $from.depth > 0) apply($from.parent,$from.before())
  else state.doc.nodesBetween(from,to,apply)
  if (transaction.docChanged) view.dispatch(transaction)
  editor.commands.focus()
}

export function bindRibbon($, getEditor, notice) {
  let paint = null
  document.querySelectorAll('.toolbar button').forEach(node => {
    node.onmousedown = event => event.preventDefault()
    if (node.dataset.command) node.onclick = () => getEditor()?.chain().focus()[node.dataset.command]().run()
  })
  $('heading').onchange = () => {
    const level = Number($('heading').value)
    const chain = getEditor()?.chain().focus()
    if (level) chain?.setHeading({level}).run()
    else chain?.setParagraph().run()
  }
  $('align').onchange = () => getEditor()?.chain().focus().setTextAlign($('align').value).run()
  $('lineHeight').onchange = () => {
    const editor = getEditor()
    if (editor) updateParagraphs(editor,()=>({lineHeight:$('lineHeight').value || null}))
  }
  const selectMark = (id,set,unset) => {
    $(id).onchange = () => {
      const value = $(id).value
      const chain = getEditor()?.chain().focus()
      if (value) chain?.[set](id === 'highlight' ? {color:value} : value).run()
      else chain?.[unset]().run()
    }
  }
  selectMark('fontFamily','setFontFamily','unsetFontFamily')
  selectMark('fontSize','setFontSize','unsetFontSize')
  selectMark('fontColor','setColor','unsetColor')
  selectMark('highlight','setHighlight','unsetHighlight')

  function changeSize(step) {
    const editor = getEditor()
    const size = Number.parseFloat(editor?.getAttributes('textStyle').fontSize) || 12
    const nearest = pointSizes.reduce((best,value,index) =>
      Math.abs(value-size) < Math.abs(pointSizes[best]-size) ? index : best, 0)
    const next = pointSizes[Math.max(0,Math.min(pointSizes.length - 1,nearest + step))]
    editor?.chain().focus().setFontSize(next + 'pt').run()
  }
  $('larger').onclick = () => changeSize(1)
  $('smaller').onclick = () => changeSize(-1)

  function indent(step) {
    const editor = getEditor()
    if (!editor) return
    if (editor.isActive('listItem')) {
      const action = step > 0 ? 'sinkListItem' : 'liftListItem'
      editor.chain().focus()[action]('listItem').run()
    } else updateParagraphs(editor, attrs => ({
      indent:Math.max(0,Math.min(6,(attrs.indent || Math.round((Number.parseFloat(attrs.wordIndent)||0)/22.5)) + step)),
      wordIndent:null,
    }))
  }
  $('indentMore').onclick = () => indent(1)
  $('indentLess').onclick = () => indent(-1)
  $('clearFormat').onclick = () => {
    const editor = getEditor()
    if (!editor) return
    editor.chain().focus().unsetAllMarks().run()
    updateParagraphs(editor,()=>Object.fromEntries(blockAttributes.map(key=>[key,key === 'indent' ? 0 : null])))
  }

  $('paint').onclick = () => {
    const editor = getEditor()
    if (!editor) return
    const {$from,empty} = editor.state.selection
    if (paint?.editor !== editor) paint = null
    if (paint) {
      if (empty) return notice('先选中要应用格式的文字。')
      let chain = editor.chain().focus()
      for (const name of markNames) chain = chain.unsetMark(name)
      for (const mark of paint.marks) chain = chain.setMark(mark.type.name,mark.attrs)
      chain.run()
      updateParagraphs(editor,()=>paint.paragraph)
      paint = null
      $('paint').setAttribute('aria-pressed','false')
      notice('已应用格式。')
      return
    }
    const marks = editor.state.storedMarks || $from.nodeAfter?.marks || $from.marks()
    const paragraph = Object.fromEntries(blockAttributes.map(name=>[name,$from.parent.attrs[name] ?? null]))
    paint = {editor,marks:marks.filter(mark=>markNames.includes(mark.type.name)),paragraph}
    $('paint').setAttribute('aria-pressed','true')
    notice('已取样。选中目标文字，再点一次格式刷。')
  }

  for (const action of ['copy','cut']) {
    $(action).onclick = () => {
      const editor = getEditor()
      if (!editor || editor.state.selection.empty) return notice('请先选中文字。')
      editor.view.focus()
      if (!document.execCommand(action)) notice(action === 'copy' ? '请用 Ctrl+C 复制。' : '请用 Ctrl+X 剪切。')
    }
  }
  $('paste').onclick = async () => {
    const editor = getEditor()
    if (!editor) return
    try {
      // Prefer the browser's paste event for formatted clipboard data. The button also supports plain text.
      const text = await navigator.clipboard.readText()
      if (getEditor() === editor && editor.isEditable && text) editor.view.pasteText(text)
    } catch { notice('浏览器限制了剪贴板读取，请用 Ctrl+V 粘贴。') }
  }

  return editor => {
    if (paint && paint.editor !== editor) {
      paint = null
      $('paint').setAttribute('aria-pressed','false')
    }
    const attributes = editor.getAttributes('textStyle')
    $('fontFamily').value = attributes.fontFamily?.replace(/["']/g,'') || ''
    $('fontSize').value = attributes.fontSize || ''
    $('fontColor').value = attributes.color || ''
    $('highlight').value = editor.getAttributes('highlight').color || ''
    const attrs = editor.state.selection.$from.parent.attrs
    $('align').value = attrs.textAlign || 'left'
    $('lineHeight').value = attrs.lineHeight || ''
  }
}
