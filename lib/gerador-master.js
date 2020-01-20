const util = require('util')
const path = require('path')
const exec = util.promisify(require('child_process').exec)
const fs = require('fs-extra')

const TIPO_MODIFICACAO = require('../lib/constants').TIPO_MODIFICACAO
class ComandoGit {

  constructor(caminhoProjeto, autor, listaTask, mostrarCommitsLocais) {
    this.caminhoProjeto = caminhoProjeto
    this.autor = autor

    this.comando = `git -C ${this.caminhoProjeto} log --reverse --regexp-ignore-case --no-merges --author=${this.autor}`

    if (mostrarCommitsLocais)
      this.comando = this.comando.concat(' --branches')
    else
      this.comando = this.comando.concat(' --remotes')

    this.comando = this.comando.concat(
      ' --name-status --pretty=format:\'%s\' -C')

    for (const task of listaTask)
      this.comando = this.comando.concat(` --grep=${task}`)
  }
}

class Commit {
  constructor(arquivo, numeroTarefa, linhaArquivo) {

    this.numeroTarefa = numeroTarefa
    this.tipoAlteracao = linhaArquivo.match(/^\w{1}/g)[0]

    if (this.isTipoAlteracaoRenomear()) {

      this.nomeAntigoArquivo = arquivo.nomeArquivo
      this.nomeNovoArquivo = linhaArquivo.match(/[^\s]*.[^\r]$/g)[0]
        .replace(/^/g, arquivo.nomeProjeto + '/').trim()
    }
  }

  isTipoAlteracaoModificacao() { return this.tipoAlteracao === 'M' }
  isTipoAlteracaoDelecao() { return this.tipoAlteracao === 'D' }
  isTipoAlteracaoRenomear() { return this.tipoAlteracao === 'R' }
}

class Arquivo {
  constructor(nomeProjeto, numeroTarefa, linhaArquivo) {

    this.nomeProjeto = nomeProjeto

    this.nomeArquivo = linhaArquivo.match(/\s.+/g)[0].match(/\w.+/g)[0]
    this.nomeArquivo = this.nomeArquivo.match(/^[^\s]*/g)[0]
      .replace(/^/g, this.nomeProjeto + '/')

    this.commit = new Commit(this, numeroTarefa, linhaArquivo)
  }
}

class Tarefa {
  constructor(numeroTarefa, tipoAlteracao) {
    this.numeroTarefa = numeroTarefa,
      this.tipoAlteracao = tipoAlteracao,
      this.numeroAlteracao = 1
  }

  isTipoAlteracaoModificacao() { return this.tipoAlteracao === TIPO_MODIFICACAO.MODIFIED }
  isTipoAlteracaoDelecao() { return this.tipoAlteracao === TIPO_MODIFICACAO.DELETED }
  isTipoAlteracaoRenomear() { return this.tipoAlteracao === TIPO_MODIFICACAO.RENAMED }
}

class Artefato {
  constructor(nomeArtefato, nomeNovoArtefato,
    nomeAntigoArtefato, nomeProjeto, listaTarefa) {

    this.nomeNovoArtefato = nomeNovoArtefato,
      this.nomeAntigoArtefato = nomeAntigoArtefato,
      this.nomeArtefato = nomeArtefato,
      this.nomeProjeto = nomeProjeto,
      this.listaTarefa = listaTarefa
  }

  obterNomeArtefatoReverso() {
    return this.nomeArtefato.split('').reverse().join('')
  }
}

class SaidaVO {
  constructor() {
      this.listaNumTarefaSaida = []
      this.listaArtefatoSaida = []
  }
}

module.exports = (params) => {

  return {

    gerarListaArtefato: async () => {

      try {
        const listaPromiseComandoGit = await obterListaPromiseComandoGit()
        let listaArquivo = await executarListaPromiseComandoGit(listaPromiseComandoGit)

        tratarArquivoRenomeado(listaArquivo)
        listaArquivo = tratarArquivoDeletado(listaArquivo)

        let listaTarefaAgrupadaPorArtefato = agruparTarefaPorArtefato(listaArquivo)

        if (!params.mostrarDeletados) {
          listaTarefaAgrupadaPorArtefato = removerArtefatoDeletado(listaTarefaAgrupadaPorArtefato)
        }

        if (!params.mostrarRenomeados) {
          listaTarefaAgrupadaPorArtefato = removerArtefatoRenomeado(listaTarefaAgrupadaPorArtefato)
        }

        const listaArtefatoComTarefaMesmoTipo = filtrarArtefatoComTarefaMesmoTipo(listaTarefaAgrupadaPorArtefato)
        const listaArtefatoSemTarefaMesmoTipo = filtrarArtefatoSemTarefaMesmoTipo(listaTarefaAgrupadaPorArtefato)

        const listaSaidaTarefasUmArtefato =
          obterListaSaidaTarefasUmArtefato(listaArtefatoComTarefaMesmoTipo)
        const listaSaidaArtefatosUmaTarefa =
          obterListaSaidaArtefatosUmaTarefa(listaArtefatoSemTarefaMesmoTipo)

        return listaSaidaTarefasUmArtefato.concat(listaSaidaArtefatosUmaTarefa)

      } catch (error) {
        throw new Error(error.message)
      }
    }
  }

  function obterListaSaidaTarefasUmArtefato(listaArtefatoComTarefaMesmoTipo) {

    return listaArtefatoComTarefaMesmoTipo.map((artefato) => {

      let saida = new SaidaVO()
      let totalModificacao = 0
      let tipoAlteracao = ''

      saida.listaNumTarefaSaida = artefato.listaTarefa.map((tarefa) => {
        totalModificacao += tarefa.numeroAlteracao
        tipoAlteracao = tarefa.tipoAlteracao

        return tarefa.numeroTarefa
      })

      let artefatoSaida = {
        nomeArtefato: artefato.nomeArtefato,
        nomeNovoArtefato: artefato.nomeNovoArtefato,
        nomeAntigoArtefato: artefato.nomeAntigoArtefato,
        tipoAlteracao: tipoAlteracao,
        numeroAlteracao: totalModificacao
      }

      saida.listaArtefatoSaida.push(artefatoSaida)

      return saida
    })
  }


  function obterListaSaidaArtefatosUmaTarefa(listaArtefatoSemTarefaMesmoTipo) {

    return params.task.reduce((accumListaTarefaComSaida, tarefaParam) => {

      const listaArtefato = listaArtefatoSemTarefaMesmoTipo.filter(artefato =>
        artefato.listaTarefa.some(tarefa =>
          tarefa.numeroTarefa === tarefaParam)
      )

      for (const tipoAlteracao of Object.values(TIPO_MODIFICACAO)) {

        let saida = new SaidaVO()

        saida.listaNumTarefaSaida.push(tarefaParam)

        saida.listaArtefatoSaida = listaArtefato.reduce((accum, artefato) => {

          const listaTarefa = artefato.listaTarefa.filter(tarefa =>
            tarefa.numeroTarefa === tarefaParam &&
            tarefa.tipoAlteracao === tipoAlteracao)

          for (const tarefa of listaTarefa) {

            accum.push({
              nomeArtefato: artefato.nomeArtefato,
              nomeNovoArtefato: artefato.nomeNovoArtefato,
              nomeAntigoArtefato: artefato.nomeAntigoArtefato,
              tipoAlteracao: tarefa.tipoAlteracao,
              numeroAlteracao: tarefa.numeroAlteracao
            })
          }

          return accum
        }, [])

        if (saida.listaArtefatoSaida.length) {
          accumListaTarefaComSaida.push(saida)
        }
      }

      return accumListaTarefaComSaida
    }, [])
  }

  /*
  Filtra artefatos com tarefas com o mesmo tipo de modificação. 
  
  ex. 
  ---
  Tarefas nº 1189666, 1176490
   
  M	2 foo-estatico/src/lista-foo.tpl.html
  ---
   
  No exemplo, o artefato lista-foo.tpl.html possui 2 tarefas (1189666 e 1176490)
  com o mesmo tipo de modificação ('M' - Modified)
  */
  function filtrarArtefatoComTarefaMesmoTipo(listaArtefato) {

    let listaArtefatoTarefaMesmoTipo = []

    for (const artefato of listaArtefato) {

      if (artefato.listaTarefa.length > 1) {

        // TODO - refatorar
        const listaTarefaMesmoTipo = artefato.listaTarefa
          .filter((tarefaAtual, indexAtual) => {

            const listaSemTarefaAtual = artefato.listaTarefa
              .filter((tarefaFilter, index) => index !== indexAtual)

            // Existe alguma outra tarefa com o mesmo tipo da atual?
            const retorno = listaSemTarefaAtual.some(tarefaSome =>
              tarefaAtual.tipoAlteracao === tarefaSome.tipoAlteracao
            )

            return retorno
          })

        if (listaTarefaMesmoTipo.length) {

          listaArtefatoTarefaMesmoTipo.push(
            new Artefato(
              artefato.nomeArtefato,
              undefined,
              undefined,
              undefined,
              listaTarefaMesmoTipo))
        }
      }
    }

    return listaArtefatoTarefaMesmoTipo
  }

  /*
  Filtra artefatos sem tarefas com o mesmo tipo de modificação. 
  
  ex. 
  ---
  Tarefas nº 1189777
   
  M	1 foo-estatico/src/lista-bar.tpl.html
  A	1 foo-estatico/src/lista-bar.tpl.html
  ---
   
  No exemplo, o artefato lista-bar.tpl.html possui tarefas únicas 
  em relação ao tipo de modificação. 'A' (Added) logicamente só aparece uma vez e
  'M' só aparece se o arquivo tiver sido modificado uma vez
  */
  function filtrarArtefatoSemTarefaMesmoTipo(listaArtefato) {

    let listaArtefatoUmTipoModificacao = []

    for (const artefato of listaArtefato) {

      if (artefato.listaTarefa.length === 1) {

        listaArtefatoUmTipoModificacao.push(artefato)

      } else if (artefato.listaTarefa.length > 1) {

        // TODO - refatorar
        const listaTarefaUnicoTipoAlteracao = artefato.listaTarefa
          .filter((tarefaAtual, indexAtual) => {

            const listaSemTarefaAtual = artefato.listaTarefa
              .filter((tarefaFilter, index) => index !== indexAtual)

            // Existe alguma outra tarefa com o mesmo tipo da atual?
            const retorno = listaSemTarefaAtual.some(
              tarefaSome => tarefaAtual.tipoAlteracao === tarefaSome.tipoAlteracao)

            return !retorno
          })

        if (listaTarefaUnicoTipoAlteracao.length) {

          listaArtefatoUmTipoModificacao.push(
            new Artefato(
              artefato.nomeArtefato,
              artefato.nomeNovoArtefato,
              artefato.nomeAntigoArtefato,
              artefato.nomeProjeto,
              listaTarefaUnicoTipoAlteracao))
        }
      }
    }

    return listaArtefatoUmTipoModificacao
  }

  function agruparTarefaPorArtefato(listaArquivo) {

    return listaArquivo.reduce((accum, arquivoReduce) => {

      const novaTarefa = new Tarefa(
        arquivoReduce.commit.numeroTarefa,
        arquivoReduce.commit.tipoAlteracao)

      const novoArtefato = new Artefato(
        arquivoReduce.nomeArquivo,
        arquivoReduce.commit.nomeNovoArquivo,
        arquivoReduce.commit.nomeAntigoArquivo,
        arquivoReduce.nomeProjeto,
        [novaTarefa])

      if (accum.length === 0) {

        accum = [novoArtefato]

      } else if (accum.length > 0) {

        let artefatoEncontrado = accum.find(artefato =>
          artefato.nomeArtefato === arquivoReduce.nomeArquivo)

        if (artefatoEncontrado) {

          let tarefaEncontrada = artefatoEncontrado.listaTarefa.find(tarefa =>
            tarefa.numeroTarefa === arquivoReduce.commit.numeroTarefa &&
            tarefa.tipoAlteracao === arquivoReduce.commit.tipoAlteracao
          )

          // Sempre pega o último commit do tipo R
          if (arquivoReduce.commit.isTipoAlteracaoRenomear()) {

            artefatoEncontrado.nomeNovoArtefato = arquivoReduce.commit.nomeNovoArquivo
            artefatoEncontrado.nomeAntigoArtefato = arquivoReduce.commit.nomeAntigoArquivo
          }

          if (tarefaEncontrada) {

            tarefaEncontrada.numeroAlteracao += 1

          } else {

            artefatoEncontrado.listaTarefa.push(novaTarefa)
          }

        } else {
          accum.push(novoArtefato)
        }
      }

      return accum

    }, []).sort(ordenarListaArtefato)
  }

  function removerArtefatoDeletado(listaTarefaAgrupadaPorArtefato) {

    return listaTarefaAgrupadaPorArtefato.reduce((accum, artefato) => {

      artefato.listaTarefa = artefato.listaTarefa.filter(tarefa => {
        return !tarefa.isTipoAlteracaoDelecao()
      })

      if (artefato.listaTarefa.length) {
        accum.push(artefato)
      }

      return accum
    }, [])
  }

  function removerArtefatoRenomeado(listaTarefaAgrupadaPorArtefato) {

    return listaTarefaAgrupadaPorArtefato.reduce((accum, artefato) => {

      artefato.listaTarefa = artefato.listaTarefa.filter(tarefa => {
        return !tarefa.isTipoAlteracaoRenomear()
      })

      if (artefato.listaTarefa.length) {
        accum.push(artefato)
      }

      return accum
    }, [])
  }

  function ordenarListaArtefato(artefatoA, artefatoB) {
    return artefatoA.nomeProjeto.localeCompare(artefatoB.nomeProjeto) ||
      artefatoA.obterNomeArtefatoReverso().localeCompare(artefatoB.obterNomeArtefatoReverso())
  }

  async function obterListaPromiseComandoGit() {

    return params.projeto.reduce((accum, caminhoProjeto) => {

      if (fs.existsSync(caminhoProjeto)) {

        let comandoGit = new ComandoGit(caminhoProjeto, params.autor, params.task,
          params.mostrarCommitsLocais)

        accum.push(exec(comandoGit.comando))

      } else {
        throw new Error('Projeto \'' + caminhoProjeto + '\' não encontrado')
      }

      return accum
    }, [])
  }

  async function executarListaPromiseComandoGit(listaPromiseComandoGit) {

    let listaCommitArquivo = []

    await Promise.all(listaPromiseComandoGit).then((listaRetornoComandoGit) => {

      for (const index in listaRetornoComandoGit) {

        if (listaRetornoComandoGit[index].stdout) {

          const nomeProjeto = path.basename(params.projeto[index])
          const lista = obterListaCommitArquivo(
            listaRetornoComandoGit[index].stdout, nomeProjeto)

          listaCommitArquivo.push.apply(listaCommitArquivo, lista)
        }
      }
    })

    return listaCommitArquivo
  }

  function obterListaCommitArquivo(saida, nomeProjeto) {

    const listaSaidaTask = saida.split(/\n{2,}/g)

    return listaSaidaTask.reduce((accum, saidaTask) => {

      const numeroTarefa = saidaTask.match(/[^\r\n]+/g)[0].match(/task.*\d/i)[0].match(/\d+/)[0]
      const listaArquivo = saidaTask.match(/[^\r\n]+/g).slice(1)

      accum.push.apply(accum,
        listaArquivo.map(arquivo => new Arquivo(nomeProjeto, numeroTarefa, arquivo)))

      return accum
    }, [])
  }

  function tratarArquivoRenomeado(listaArquivo) {

    let listaArquivoRenomeado = listaArquivo.filter(
      arquivoFilter => arquivoFilter.commit.isTipoAlteracaoRenomear())

    for (const arquivoRenomeado of listaArquivoRenomeado) {

      const lista = listaArquivo.filter(arquivo =>
        (arquivo.nomeArquivo === arquivoRenomeado.commit.nomeAntigoArquivo))

      lista.forEach(arquivo =>
        arquivo.nomeArquivo = arquivoRenomeado.commit.nomeNovoArquivo)
    }
  }

  function tratarArquivoDeletado(listaArquivo) {

    let listaArquivoDeletado = listaArquivo.filter(
      arquivoFilter => arquivoFilter.commit.isTipoAlteracaoDelecao())

    return listaArquivoDeletado.reduce((accum, arquivoDeletado) => {

      const index = listaArquivo.findIndex(arquivo =>
        arquivoDeletado.nomeArquivo === arquivo.nomeArquivo &&
        arquivoDeletado.commit.tipoAlteracao === arquivo.commit.tipoAlteracao
      )

      accum = listaArquivo.filter((commitArquivo, indexCommitArquivo) =>
        commitArquivo.nomeArquivo !== arquivoDeletado.nomeArquivo || indexCommitArquivo >= index
      )

      return accum
    }, listaArquivo)
  }
}