import io
import tempfile
import unittest
from pathlib import Path
from raf.server import Application
from raf.store import Store
from raf.rights import require_public_display
from raf.answers import answer
from tests.helpers import bundle, FakeEmbedder
from raf.retrieval import chunk_similarities
from raf.embeddings import ProviderError
from raf.policy import classify


class ResearchTests(unittest.TestCase):
    def test_short_named_topic_can_be_searched(self):
        self.assertEqual(classify('زكاة الحلي'),'explain')
        self.assertEqual(classify('ما حكم هذا'),'clarify')

    def test_explicit_external_facts_are_not_answered_from_incidental_mentions(self):
        self.assertEqual(classify('ما هي عاصمة اليابان؟'),'insufficient')
        self.assertEqual(classify('اكتب كود للعبة'),'insufficient')
        self.assertEqual(classify('ما حكم شراء أسهم شركة برمجة؟'),'explain')

    def test_vectorized_cosine_preserves_ranking_and_rejects_wrong_dimension(self):
        release={'chunks':[{'vector':[3.0,4.0]},{'vector':[-4.0,3.0]}]}
        values=chunk_similarities(release,[6.0,8.0])
        self.assertAlmostEqual(values[0],1.0,places=6)
        self.assertAlmostEqual(values[1],0.0,places=6)
        with self.assertRaises(ProviderError):chunk_similarities(release,[1.0])

    def test_research_never_grants_public_rights(self):
        manifest = bundle()['manifest']
        manifest['research_only'] = True
        with self.assertRaisesRegex(ValueError, 'research'):
            require_public_display(manifest)

    def test_remote_clients_and_rebinding_hosts_blocked(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Application(Store(Path(directory)/'local.db'),FakeEmbedder(),research=True)
            for address,host,expected in [('127.0.0.1','localhost:8000',200),
                                          ('127.0.0.1','evil.example:8000',403),
                                          ('192.168.1.3','localhost:8000',403)]:
                result=[]
                list(app({'REQUEST_METHOD':'GET','PATH_INFO':'/api/health',
                          'HTTP_HOST':host,'REMOTE_ADDR':address,'wsgi.input':io.BytesIO()},
                         lambda status,headers:result.append(status)))
                self.assertTrue(result[0].startswith(str(expected)))

    def test_research_does_not_apply_personal_fatwa(self):
        class NoRead:
            def release(self,*args):
                raise AssertionError('Personal case should be referred before retrieval')
        result = answer(NoRead(),'test','طلقت زوجتي فهل وقع الطلاق؟',research=True)
        self.assertEqual(result['citations'],[])

    def test_default_answer_rejects_research_release(self):
        data=bundle();data['manifest']['research_only']=True
        class Memory:
            def release(self,*args):return data
        self.assertEqual(answer(Memory(),'test','alpha catalog question')['kind'],'unavailable')
