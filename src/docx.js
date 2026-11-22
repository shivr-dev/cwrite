import DOMPurify from 'dompurify'
import mammoth from 'mammoth/mammoth.browser.js'
import { preserveWordStyles } from './word-styles.js'
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun, LevelFormat,
  LineRuleType, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx'

const imagePattern = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/i

export async function importDocx(file) {
  if (!/\.docx$/i.test(file.name) || file.size > 4 * 1024 * 1024) {
    throw new Error('请选择不超过 4 MB 的 .docx 文件。')
  }
  const word = await preserveWordStyles(await file.arrayBuffer())
  const {value, messages} = await mammoth.convertToHtml({arrayBuffer:word.arrayBuffer}, {
    styleMap:word.styleMap,
    convertImage: mammoth.images.imgElement(async image => {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(image.contentType)) return {}
      const data = await image.read('base64')
      return data.length < 340000 ? {src:'data:' + image.contentType + ';base64,' + data} : {}
    }),
  })
  const html = DOMPurify.sanitize(word.apply(value), {USE_PROFILES:{html:true}, FORBID_TAGS:['style','iframe','form']})
  if (new TextEncoder().encode(html).length > 720000) throw new Error('转换后的文档过大。请缩小图片或分开导入。')
  return {html, warnings: word.warnings || messages.length > 0 || /<img(?![^>]*src=)/i.test(html)}
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3]
const align = {left:AlignmentType.LEFT,center:AlignmentType.CENTER,right:AlignmentType.RIGHT,justify:AlignmentType.JUSTIFIED}
function hex(value) {
  if (typeof value !== 'string') return
  if (/^#[a-f0-9]{6}$/i.test(value)) return value.slice(1).toUpperCase()
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(value)
  if (rgb && rgb.slice(1).every(channel=>Number(channel) <= 255)) {
    return rgb.slice(1).map(channel=>Number(channel).toString(16).padStart(2,'0')).join('').toUpperCase()
  }
}
const twips = value => typeof value === 'string' && /^-?\d+(\.\d+)?pt$/.test(value) ? Math.round(Number.parseFloat(value)*20) : undefined

function runs(nodes = []) {
  return nodes.flatMap(node => {
    if (node.type === 'hardBreak') return [new TextRun({break:1})]
    if (node.type !== 'text') return []
    const marks = new Map((node.marks || []).map(mark => [mark.type, mark.attrs]))
    const link = marks.get('link')?.href
    const linked = typeof link === 'string' && /^(https?:|mailto:)/i.test(link)
    const textStyle = marks.get('textStyle')
    const size = typeof textStyle?.fontSize === 'string' && /^(\d+|\d+\.5)pt$/.test(textStyle.fontSize)
      ? Number.parseFloat(textStyle.fontSize) * 2 : undefined
    const fill = hex(marks.get('highlight')?.color)
    const fonts = typeof textStyle?.fontFamily === 'string' ? textStyle.fontFamily.split(',').map(name=>name.trim().replace(/["']/g,'')) : []
    const font = marks.has('code') ? 'Consolas' : fonts.at(-1)
    const run = new TextRun({
      text:node.text, bold:marks.has('bold'), italics:marks.has('italic'),
      underline:marks.has('underline') || linked ? {} : undefined,
      strike:marks.has('strike'), size,
      font:font ? {ascii:font,eastAsia:fonts[0] || font,hAnsi:font} : undefined,
      color:hex(textStyle?.color) || (linked ? '175D52' : undefined),
      subScript:marks.has('subscript'), superScript:marks.has('superscript'),
      shading:fill ? {fill,type:ShadingType.CLEAR} : undefined,
    })
    return linked ? [new ExternalHyperlink({children:[run],link})] : [run]
  })
}

const levels = (format, marker, start = 1) => Array.from({length:8}, (_, level) => ({
  level, format, text:marker(level), start,
  style:{paragraph:{indent:{left:720+level*360,hanging:300}}},
}))

export async function exportDocx(title, data) {
  const numbering = {config:[{reference:'bullet',levels:levels(LevelFormat.BULLET, ()=>'•')}]}
  let listId = 0
  function blocks(nodes = [], list = null) {
    return nodes.flatMap(node => {
      const children = node.content || []
      if (node.type === 'bulletList' || node.type === 'orderedList') {
        const level = Math.min((list?.level ?? -1) + 1, 7)
        let reference = 'bullet'
        if (node.type === 'orderedList') {
          reference = 'ordered-' + (++listId)
          numbering.config.push({reference,levels:levels(LevelFormat.DECIMAL, index=>'%' + (index+1) + '.', node.attrs?.start || 1)})
        }
        return children.flatMap(item => (item.content || []).flatMap((part,index) =>
          blocks([part], {reference,level, first:index === 0})))
      }
      if (node.type === 'table') {
        return [new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:children.map(row =>
          new TableRow({children:(row.content || []).map(cell => new TableCell({
            children:blocks(cell.content), columnSpan:cell.attrs?.colspan || 1,
            rowSpan:cell.attrs?.rowspan || 1,
            shading:cell.type === 'tableHeader' ? {fill:'E3F2EC'} : undefined,
          }))}))})]
      }
      if (node.type === 'blockquote') {
        return children.map(part => new Paragraph({children:runs(part.content),indent:{left:400},
          border:{left:{style:BorderStyle.SINGLE,size:12,color:'16836E',space:10}}, spacing:{after:145}}))
      }
      if (node.type === 'horizontalRule') return [new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:5,color:'BAC7C4'}}})]
      if (node.type === 'image') {
        const match = imagePattern.exec(node.attrs?.src || '')
        if (!match || match[1].toLowerCase() === 'webp') return [new Paragraph({text:node.attrs?.alt || '［图片］'})]
        const data = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))
        return [new Paragraph({children:[new ImageRun({type:match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase(),data,
          transformation:{width:360,height:240}})]})]
      }
      const attrs = node.attrs || {}
      const line = Number(attrs.lineHeight)
      const exactLine = twips(attrs.lineHeight)
      const spacing = {before:twips(attrs.spaceBefore),after:twips(attrs.spaceAfter) ?? 145}
      if (line > 0 && line <= 8) Object.assign(spacing,{line:Math.round(line*240),lineRule:LineRuleType.AUTO})
      if (exactLine > 0) Object.assign(spacing,{line:exactLine,lineRule:LineRuleType.EXACT})
      const left = twips(attrs.wordIndent) ?? (attrs.indent > 0 && attrs.indent <= 6 ? 450 * attrs.indent : undefined)
      const firstLine = twips(attrs.firstLineIndent)
      return [new Paragraph({
        children:runs(children), heading:node.type === 'heading' ? heading[node.attrs?.level - 1] : undefined,
        alignment:align[node.attrs?.textAlign], spacing,
        numbering:list?.first ? {reference:list.reference,level:list.level} : undefined,
        indent:list && !list.first ? {left:720+list.level*360} : {
          left,right:twips(attrs.wordRightIndent),firstLine:firstLine > 0 ? firstLine : undefined,
          hanging:firstLine < 0 ? -firstLine : undefined,
        },
      })]
    })
  }
  return Packer.toBlob(new Document({
    title, numbering,
    styles:{default:{document:{run:{font:{ascii:'Aptos',eastAsia:'Microsoft YaHei'},size:22}}}},
    sections:[{
      properties:{page:{size:{width:11906,height:16838},margin:{top:1134,right:1134,bottom:1134,left:1134}}},
      children:[new Paragraph({text:title,heading:HeadingLevel.TITLE}),...blocks(data.content)],
    }],
  }))
}
