import JSZip from 'jszip'

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const markerPrefix = 'CwriteFormat'
const maxFormats = 384
const children = element => [...(element?.children || [])]
const child = (element,name) => children(element).find(node=>node.namespaceURI === NS && node.localName === name)
const attr = (element,name) => element?.getAttributeNS(NS,name) || null
const value = (element,name) => attr(child(element,name),'val')
const word = (doc,name) => doc.createElementNS(NS,'w:'+name)
const hex = color => /^([0-9a-f]{6})$/i.test(color || '') ? '#' + color.toLowerCase() : null
const points = (source,divisor,allowNegative = false) => {
  if (!/^-?\d+$/.test(source || '')) return null
  const number = Number(source)/divisor
  if (number > 720 || (!allowNegative && number < 0) || number < -720) return null
  return number
}
const flags = {b:'strong',i:'em',u:'u',strike:'s',caps:null,smallCaps:null}
const highlight = {
  yellow:'#ffff00',green:'#00ff00',cyan:'#00ffff',magenta:'#ff00ff',blue:'#0000ff',red:'#ff0000',
  darkBlue:'#000080',darkCyan:'#008080',darkGreen:'#008000',darkMagenta:'#800080',darkRed:'#800000',
  darkYellow:'#808000',darkGray:'#808080',lightGray:'#c0c0c0',black:'#000000',
}
const parse = source => {
  const result = new DOMParser().parseFromString(source,'application/xml')
  if (result.querySelector('parsererror')) throw new Error('这个 DOCX 的正文或样式无法读取。')
  return result
}
function propertyMap(...blocks) {
  const result = new Map()
  for (const block of blocks) {
    for (const node of children(block)) {
      if (node.namespaceURI !== NS) continue
      const properties = {...result.get(node.localName)}
      for (const item of node.attributes) if (item.namespaceURI === NS) properties[item.localName] = item.value
      if (!Object.keys(properties).length) properties.val = 'true'
      result.set(node.localName,properties)
    }
  }
  return result
}
const enabled = (properties,name) => properties.has(name) && !['false','off','none','0'].includes(properties.get(name).val)

function runFormat(properties) {
  const styles = {}
  const tags = Object.entries(flags).filter(([name,tag])=>tag && enabled(properties,name)).map(([,tag])=>tag)
  const vertical = properties.get('vertAlign')?.val
  if (vertical === 'superscript') tags.push('sup')
  if (vertical === 'subscript') tags.push('sub')
  const font = properties.get('rFonts')
  const size = points(properties.get('sz')?.val,2)
  const color = hex(properties.get('color')?.val)
  const fontFamily = [...new Set([font?.eastAsia,font?.ascii,font?.hAnsi].filter(name=>
    typeof name === 'string' && /^[\p{L}\p{N} ._()-]{1,64}$/u.test(name)))].map(name=>'"'+name+'"').join(', ')
  if (fontFamily) styles.fontFamily = fontFamily
  if (size && size <= 120) styles.fontSize = size + 'pt'
  if (color) styles.color = color
  const fill = highlight[properties.get('highlight')?.val] || hex(properties.get('shd')?.fill)
  return {styles,tags,fill:fill || null}
}

function paragraphFormat(properties) {
  const styles = {}
  const indent = properties.get('ind')
  const space = properties.get('spacing')
  const alignment = properties.get('jc')?.val
  const align = {start:'left',end:'right',left:'left',right:'right',center:'center',both:'justify',distribute:'justify'}
  if (align[alignment]) styles.textAlign = align[alignment]
  const firstLine = points(indent?.firstLine,20,true)
  const hanging = points(indent?.hanging,20)
  for (const [key,number] of Object.entries({
    marginLeft:points(indent?.start || indent?.left,20,true),
    marginRight:points(indent?.end || indent?.right,20,true),
    marginTop:points(space?.before,20),
    marginBottom:points(space?.after,20),
    textIndent:firstLine ?? (hanging ? -hanging : null),
  })) if (number !== null) styles[key] = number + 'pt'
  const line = points(space?.line,space?.lineRule === 'auto' || !space?.lineRule ? 240 : 20)
  if (line > 0) styles.lineHeight = space?.lineRule === 'auto' || !space?.lineRule ? String(line) : line + 'pt'
  return {styles}
}

export async function preserveWordStyles(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const main = zip.file('word/document.xml')
  if (!main) throw new Error('文件中没有可编辑的 Word 正文。')
  const source = await main.async('string')
  if (source.length > 8_000_000) throw new Error('文档正文过大，请拆成几份再导入。')
  const xml = parse(source)
  const styleEntry = zip.file('word/styles.xml')
  const styles = styleEntry ? parse(await styleEntry.async('string')) : parse('<w:styles xmlns:w="'+NS+'"/>')
  const styleMap = new Map()
  let normal
  for (const style of styles.getElementsByTagNameNS(NS,'style')) {
    const id = attr(style,'styleId')
    if (id) styleMap.set(id,style)
    if (attr(style,'type') === 'paragraph' && attr(style,'default') === '1') normal = id
  }
  function ancestors(id) {
    const seen = new Set()
    const result = []
    while (id && styleMap.has(id) && !seen.has(id) && result.length < 32) {
      seen.add(id)
      const style = styleMap.get(id)
      result.unshift(style)
      id = value(style,'basedOn')
    }
    return result
  }
  const defaults = child(styles.documentElement,'docDefaults')
  const defaultRun = child(child(defaults,'rPrDefault'),'rPr')
  const defaultParagraph = child(child(defaults,'pPrDefault'),'pPr')
  const formats = new Map()
  let truncated = false
  function marker(kind,format) {
    if (!Object.keys(format.styles).length && !format.tags?.length && !format.fill) return null
    const signature = kind + JSON.stringify(format)
    if (formats.has(signature)) return formats.get(signature).id
    if (formats.size >= maxFormats) { truncated = true; return null }
    let id = markerPrefix + formats.size
    while (styleMap.has(id)) id += 'X'
    formats.set(signature,{id,kind,format})
    const style = word(styles,'style')
    style.setAttributeNS(NS,'w:type','character')
    style.setAttributeNS(NS,'w:styleId',id)
    const name = word(styles,'name')
    name.setAttributeNS(NS,'w:val',id)
    style.append(name)
    styles.documentElement.append(style)
    return id
  }
  function setRunStyle(run,id) {
    let properties = child(run,'rPr')
    if (!properties) { properties = word(xml,'rPr'); run.prepend(properties) }
    let style = child(properties,'rStyle')
    if (!style) { style = word(xml,'rStyle'); properties.prepend(style) }
    style.setAttributeNS(NS,'w:val',id)
  }
  for (const paragraph of xml.getElementsByTagNameNS(NS,'p')) {
    const properties = child(paragraph,'pPr')
    const chain = ancestors(value(properties,'pStyle') || normal)
    const para = marker('paragraph',paragraphFormat(propertyMap(defaultParagraph,...chain.map(style=>child(style,'pPr')),properties)))
    const runs = [...paragraph.getElementsByTagNameNS(NS,'r')].filter(run=>{
      let parent = run.parentElement
      while (parent && parent.localName !== 'p') parent = parent.parentElement
      return parent === paragraph
    })
    for (const run of runs) {
      if (!child(run,'t') && !child(run,'tab')) continue
      const direct = child(run,'rPr')
      const character = ancestors(value(direct,'rStyle'))
      const resolved = propertyMap(defaultRun,...chain.map(style=>child(style,'rPr')),...character.map(style=>child(style,'rPr')),direct)
      const id = marker('run',runFormat(resolved))
      if (id) setRunStyle(run,id)
    }
    if (para) {
      const run = word(xml,'r')
      setRunStyle(run,para)
      const text = word(xml,'t')
      text.textContent = '\u2060'
      run.append(text)
      paragraph.insertBefore(run,properties ? properties.nextSibling : paragraph.firstChild)
    }
  }
  if (formats.size) {
    const serializer = new XMLSerializer()
    zip.file('word/document.xml',serializer.serializeToString(xml))
    zip.file('word/styles.xml',serializer.serializeToString(styles))
  }
  const pageLayout = [...xml.getElementsByTagNameNS(NS,'sectPr')]
  const unsupported = ['drawing','pict','object','footnoteReference','endnoteReference','ins','del','br'].some(name=>
    [...xml.getElementsByTagNameNS(NS,name)].some(el=>name === 'br' ? attr(el,'type') === 'page' : true))
    || pageLayout.length > 1 || pageLayout.some(section=>attr(child(section,'pgSz'),'orient') === 'landscape')
    || ['word/header1.xml','word/footer1.xml'].some(path=>zip.file(path))
  return {
    arrayBuffer:formats.size ? await zip.generateAsync({type:'arraybuffer',compression:'DEFLATE'}) : buffer,
    styleMap:[...formats.values()].map(({id})=>'r.'+id+' => span.'+id+':fresh'),
    warnings:truncated || unsupported,
    apply(html) {
      const container = document.createElement('template')
      container.innerHTML = html
      for (const {id,kind,format} of formats.values()) {
        for (const node of container.content.querySelectorAll('.'+id)) {
          if (kind === 'paragraph') {
            const block = node.closest('p,h1,h2,h3,h4,h5,h6,li,td,th')
            if (block) Object.assign(block.style,format.styles)
            node.remove()
            continue
          }
          node.removeAttribute('class')
          Object.assign(node.style,format.styles)
          for (const tag of format.tags) {
            const wrapper = document.createElement(tag)
            wrapper.append(...node.childNodes)
            node.append(wrapper)
          }
          if (format.fill) {
            const mark = document.createElement('mark')
            mark.dataset.color = format.fill
            mark.style.backgroundColor = format.fill
            mark.append(...node.childNodes)
            node.append(mark)
          }
        }
      }
      return container.innerHTML
    },
  }
}
