import ollama
import subprocess
import json

# Histórico de memória do Jarvis
mensagens = [
    {
        'role': 'system',
        'content': 'Você é o Jarvis. Responda de forma concisa e direta. Se receber um JSON com análise de código, explique o que o código faz de forma simples.'
    }
]

def executar_rea(caminho_arquivo):
    """Função que o Jarvis usa para rodar o REA e analisar arquivos"""
    print(f"[Jarvis] Analisando {caminho_arquivo} com REA...")
    try:
        # Executa a CLI do REA pedindo o resultado em JSON
        resultado = subprocess.run(
            ['npx', 'rea-agents', 'analyze', caminho_arquivo, '--json'],
            capture_output=True, text=True, check=True
        )
        return resultado.stdout
    except Exception as e:
        return f"Erro ao analisar o arquivo: {e}"

print("Jarvis ativado. Digite 'sair' para encerrar ou 'analisar <caminho>' para usar o REA.")

while True:
    comando = input("\nVocê: ")
    
    if comando.lower() == 'sair':
        break
        
    # Gatilho manual para acionar a ferramenta do REA
    if comando.startswith('analisar '):
        arquivo = comando.split(' ')[1]
        analise_json = executar_rea(arquivo)
        # Injeta o resultado do REA no contexto do Jarvis
        mensagens.append({'role': 'user', 'content': f"Aqui está a análise do arquivo {arquivo}:\n{analise_json}\nExplique o que isso significa."})
    else:
        mensagens.append({'role': 'user', 'content': comando})

    print("\nJarvis: ", end="", flush=True)
    
    # Envia para o Qwen via Ollama com streaming ativo (digita palavra por palavra)
    resposta_completa = ""
    for pedaco in ollama.chat(model='qwen2.5:1.5b', messages=mensagens, stream=True):
        texto = pedaco['message']['content']
        print(texto, end="", flush=True)
        resposta_completa += texto
        
    # Salva a resposta no histórico para ele ter contexto nas próximas perguntas
    mensagens.append({'role': 'assistant', 'content': resposta_completa})
    print()
