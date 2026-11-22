import { Editor, Extension, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { CollaboratorCarets } from './carets.js'

export const fontFamilies = ['Microsoft YaHei', 'SimSun', 'KaiTi', 'Arial', 'Times New Roman']
export const lineHeights = ['1', '1.15', '1.5', '1.8', '2']
const wordParagraphProperties = {
  wordIndent:'margin-left',wordRightIndent:'margin-right',firstLineIndent:'text-indent',
  spaceBefore:'margin-top',spaceAfter:'margin-bottom',
}
const pointValue = value => typeof value === 'string' && /^-?\d{1,3}(\.\d{1,4})?pt$/.test(value) ? value : null
const lineValue = value => pointValue(value) ||
  (typeof value === 'string' && /^\d(\.\d{1,6})?$/.test(value) && Number(value) > 0 ? value : null)
const imageSource = source => typeof source === 'string' && source.length <= 350000 &&
  /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(source)

const ParagraphFormat = Extension.create({
  name:'paragraphFormat',
  addGlobalAttributes() {
    return [{
      types:['paragraph','heading'],
      attributes:{
        indent:{
          default:0,
          parseHTML: element => Math.max(0,Math.min(6,Number(element.dataset.indent) || 0)),
          renderHTML: ({indent}) => Number.isInteger(indent) && indent > 0 && indent <= 6
            ? {'data-indent':indent,style:'margin-left:' + indent * 2 + 'em'} : {},
        },
        lineHeight:{
          default:null,
          parseHTML: element => lineValue(element.style.lineHeight),
          renderHTML: ({lineHeight}) => lineValue(lineHeight) ? {style:'line-height:' + lineHeight} : {},
        },
        ...Object.fromEntries(Object.entries(wordParagraphProperties).map(([key,style])=>[key,{
          default:null,
          parseHTML:element=>pointValue(element.style.getPropertyValue(style)),
          renderHTML:attrs=>pointValue(attrs[key]) ? {style:style+':'+attrs[key]} : {},
        }])),
      },
    }]
  },
})

const ReportImage = Image.extend({
  parseHTML() {
    return [{
      tag: 'img[src]',
      getAttrs: node => imageSource(node.getAttribute('src')) ? null : false,
    }]
  },
  renderHTML({HTMLAttributes}) {
    const {src,alt,title} = HTMLAttributes
    if (!imageSource(src)) return ['span', {'aria-label':'无法显示的图片'}, '［图片］']
    return ['img',mergeAttributes(this.options.HTMLAttributes,{src,alt,title})]
  },
})

export function createEditor(element, document, editable, onUpdate) {
  return new Editor({
    element, editable,
    extensions: [
      StarterKit.configure({undoRedo:false, heading:{levels:[1,2,3]}, link:{openOnClick:false}}),
      Collaboration.configure({document}),
      TableKit,
      TextAlign.configure({types:['heading','paragraph']}),
      ReportImage.configure({allowBase64:true}),
      TextStyle, Color, FontFamily, FontSize, Highlight.configure({multicolor:true}),
      Subscript, Superscript, ParagraphFormat, CollaboratorCarets,
    ],
    editorProps: {attributes: {'class':'report-prose','aria-label':'报告正文', 'spellcheck':'false'}},
    onTransaction: onUpdate,
  })
}

export const sample = {
  type:'doc', content:[
    {type:'paragraph', content:[{type:'text',text:'这是一份可以动手编辑的示例。团队正式报告可以从空白文稿开始，也可以导入现有的 Word 文件。'}]},
    {type:'heading', attrs:{level:2}, content:[{type:'text',text:'研究背景'}]},
    {type:'paragraph', content:[{type:'text',text:'课间结束后，教室常常留下一些还能使用的草稿纸。我们想了解这些纸张为何被丢弃，以及怎样让它们更容易被再次使用。'}]},
    {type:'heading', attrs:{level:2}, content:[{type:'text',text:'研究问题'}]},
    {type:'blockquote',content:[{type:'paragraph',content:[{type:'text',text:'在教室里放置草稿纸回收盒，会提高同学们重复使用纸张的意愿吗？'}]}]},
    {type:'heading', attrs:{level:2}, content:[{type:'text',text:'行动计划'}]},
    {type:'orderedList',content:['记录一周内还能使用却被丢弃的纸张数量。','设置草稿纸回收盒，观察同学们如何使用。','对照活动前后的数据，并访谈参与的同学。'].map(text=>({
      type:'listItem',content:[{type:'paragraph',content:[{type:'text',text}]}],
    }))},
  ],
}
